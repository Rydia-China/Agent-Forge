import { prisma } from "@/lib/db";
import { EventEmitter } from "node:events";
import { runAgentStream } from "@/lib/agent/agent";
import type { StreamCallbacks, KeyResourceEvent, AgentConfig } from "@/lib/agent/agent";
import type { ToolCall } from "@/lib/agent/types";
import { upsertResource } from "@/lib/services/key-resource-service";
import type { Prisma } from "@/generated/prisma";
import {
  acquire,
  removeFromQueue,
  getQueuePosition,
  getConcurrencyStatus,
  TASK_TIMEOUT_MS,
} from "@/lib/agent/concurrency";
export { getConcurrencyStatus } from "@/lib/agent/concurrency";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface TaskEventRow {
  id: number;
  taskId: string;
  type: string;
  data: Prisma.JsonValue;
  createdAt: Date;
}

/** Sentinel emitted when a task finishes (completed/failed/cancelled). */
const TASK_END = Symbol("task-end");

/* ------------------------------------------------------------------ */
/*  In-memory state  (survives Next.js HMR)                            */
/* ------------------------------------------------------------------ */

const globalForTask = globalThis as unknown as {
  __taskEmitter?: EventEmitter;
  __taskAborts?: Map<string, AbortController>;
  __novelFeedEmitter?: EventEmitter;
  __taskTimeouts?: Map<string, ReturnType<typeof setTimeout>>;
  __taskRecoveryDone?: boolean;
};

/** Emits `event:<taskId>` for live events, `end:<taskId>` on finish. */
const emitter = (globalForTask.__taskEmitter ??= (() => {
  const e = new EventEmitter();
  e.setMaxListeners(0);
  return e;
})());

/** Emits novel-level task lifecycle events: `novel:<novelId>` */
const novelFeed = (globalForTask.__novelFeedEmitter ??= (() => {
  const e = new EventEmitter();
  e.setMaxListeners(0);
  return e;
})());

/** Active tasks' AbortControllers, keyed by taskId. */
const activeAborts = (globalForTask.__taskAborts ??= new Map());

/** Active task timeout timers, keyed by taskId. */
const taskTimeouts = (globalForTask.__taskTimeouts ??= new Map());

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function summarizeTool(call: ToolCall): string {
  // Skill protocol: any provider's get_skill, or skill_admin CRUD
  if (call.function.name.endsWith("__get_skill") || call.function.name.startsWith("skill_admin__")) {
    try {
      const parsed: unknown = JSON.parse(call.function.arguments);
      if (typeof parsed === "object" && parsed !== null) {
        const name = (parsed as Record<string, unknown>).name;
        if (typeof name === "string" && name.trim().length > 0) {
          return `使用了 skill：${name}`;
        }
        const names = (parsed as Record<string, unknown>).names;
        if (Array.isArray(names) && names.length > 0) {
          return `使用了 skill：${names.join(", ")}`;
        }
      }
    } catch {
      /* ignore */
    }
    return "使用了 skill";
  }
  return `调用了工具：${call.function.name}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Detect Prisma "record not found" errors (P2025) — task/session already deleted. */
function isRecordNotFound(err: unknown): boolean {
  return isRecord(err) && (err as Record<string, unknown>).code === "P2025";
}

/** Detect Prisma "foreign key violation" errors (P2003) — parent row deleted. */
function isFkViolation(err: unknown): boolean {
  return isRecord(err) && (err as Record<string, unknown>).code === "P2003";
}

/* ------------------------------------------------------------------ */
/*  Novel feed helpers                                                 */
/* ------------------------------------------------------------------ */

export interface NovelFeedEvent {
  type: "task_queued" | "task_started" | "task_completed" | "task_failed" | "task_cancelled";
  taskId: string;
  sessionId: string;
  scriptKey: string | null;
  novelId: string | null;
  error?: string;
  replyPreview?: string;
}

/**
 * Resolve novelId from the session's userName.
 * userName format: `video:{novelId}:{scriptKey}` or `video:{novelId}`
 */
function resolveNovelInfo(userName: string): { novelId: string | null; scriptKey: string | null } {
  if (!userName.startsWith("video:")) return { novelId: null, scriptKey: null };
  const parts = userName.slice(6).split(":");
  return {
    novelId: parts[0] ?? null,
    scriptKey: parts[1] && parts[1] !== "_" ? parts[1] : null,
  };
}

async function resolveTaskNovelInfo(sessionId: string): Promise<{ novelId: string | null; scriptKey: string | null }> {
  const session = await prisma.chatSession.findUnique({
    where: { id: sessionId },
    select: { user: { select: { name: true } } },
  });
  if (!session) return { novelId: null, scriptKey: null };
  return resolveNovelInfo(session.user.name);
}

function emitNovelFeed(event: NovelFeedEvent): void {
  if (event.novelId) {
    novelFeed.emit(`novel:${event.novelId}`, event);
  }
}

/* ------------------------------------------------------------------ */
/*  terminateTask — consistent 4-step terminal write                    */
/* ------------------------------------------------------------------ */

async function terminateTask(
  taskId: string,
  sessionId: string,
  status: "completed" | "failed" | "cancelled",
  opts: { reply?: string; error?: string },
): Promise<void> {
  // 1. Update Task (may already be deleted by cascade)
  try {
    await prisma.task.update({
      where: { id: taskId },
      data: {
        status,
        reply: opts.reply ?? null,
        error: opts.error ?? null,
      },
    });
  } catch (err: unknown) {
    // Task row already deleted (e.g. session cascade) — just emit in-memory end
    if (isRecordNotFound(err)) {
      console.warn(`[task:${taskId}] terminateTask(${status}): task already deleted, skipping DB writes`);
      emitter.emit(`end:${taskId}`, TASK_END);
      return;
    }
    throw err;
  }

  // 2. Write terminal TaskEvent
  if (status === "completed") {
    await pushEvent(taskId, "done", {
      session_id: sessionId,
      reply: opts.reply ?? "",
    });
  } else {
    await pushEvent(taskId, "error", {
      error: opts.error ?? (status === "cancelled" ? "Task cancelled" : "Unknown error"),
    });
  }

  // 3. In-memory emitter for SSE subscribers
  emitter.emit(`end:${taskId}`, TASK_END);

  // 4. Novel-level feed
  const info = await resolveTaskNovelInfo(sessionId);
  const feedType = status === "completed" ? "task_completed"
    : status === "cancelled" ? "task_cancelled"
    : "task_failed";
  emitNovelFeed({
    type: feedType,
    taskId,
    sessionId,
    scriptKey: info.scriptKey,
    novelId: info.novelId,
    error: opts.error,
    replyPreview: opts.reply?.slice(0, 200),
  });
}

/* ------------------------------------------------------------------ */
/*  Startup recovery — mark stale tasks as failed                      */
/* ------------------------------------------------------------------ */

export async function recoverStaleTasks(): Promise<number> {
  if (globalForTask.__taskRecoveryDone) return 0;
  globalForTask.__taskRecoveryDone = true;

  const staleTasks = await prisma.task.findMany({
    where: { status: { in: ["pending", "running"] } },
    select: { id: true, sessionId: true, status: true },
  });

  if (staleTasks.length === 0) return 0;

  console.log(`[task-recovery] Found ${staleTasks.length} stale task(s), marking as failed`);

  for (const task of staleTasks) {
    const errorMsg = "服务在任务执行过程中重启，请确认是否需要重试";
    try {
      await prisma.task.update({
        where: { id: task.id },
        data: { status: "failed", error: errorMsg },
      });
      // Write error event so replay sees it
      await prisma.taskEvent.create({
        data: {
          taskId: task.id,
          type: "error",
          data: { error: errorMsg } as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      console.error(`[task-recovery] Failed to recover task ${task.id}:`, err);
    }
  }

  return staleTasks.length;
}

/* ------------------------------------------------------------------ */
/*  Watchdog — periodic scan for stuck tasks                           */
/* ------------------------------------------------------------------ */

const WATCHDOG_INTERVAL_MS = 5 * 60_000; // 5 minutes
const WATCHDOG_THRESHOLD_MS = TASK_TIMEOUT_MS + 5 * 60_000; // timeout + 5min buffer

export function startWatchdog(): void {
  setInterval(async () => {
    try {
      const threshold = new Date(Date.now() - WATCHDOG_THRESHOLD_MS);
      const stuck = await prisma.task.findMany({
        where: {
          status: "running",
          updatedAt: { lt: threshold },
        },
        select: { id: true, sessionId: true },
      });

      for (const task of stuck) {
        console.warn(`[watchdog] Task ${task.id} stuck, force-failing`);
        const ac = activeAborts.get(task.id);
        if (ac) ac.abort();
        // Give abort handler a moment, then force-terminate
        setTimeout(async () => {
          const current = await prisma.task.findUnique({
            where: { id: task.id },
            select: { status: true },
          });
          if (current && (current.status === "running" || current.status === "pending")) {
            await terminateTask(task.id, task.sessionId, "failed", {
              error: "任务长时间无进展，系统判定为卡死",
            }).catch((err) => console.error(`[watchdog] terminateTask failed:`, err));
            activeAborts.delete(task.id);
            clearPushQueue(task.id);
          }
        }, 5000);
      }
    } catch (err) {
      console.error("[watchdog] scan error:", err);
    }
  }, WATCHDOG_INTERVAL_MS);
}

/**
 * Per-task serial queue for pushEvent.
 * Ensures events are written to DB and emitted in call order,
 * even when callbacks fire in rapid succession (e.g. tool_start → tool_end).
 */
const pushQueues = new Map<string, Promise<unknown>>();

function clearPushQueue(taskId: string): void {
  pushQueues.delete(taskId);
}

/** Persist a TaskEvent to DB and emit to in-memory subscribers. */
function pushEvent(
  taskId: string,
  type: string,
  data: Prisma.InputJsonValue,
): Promise<TaskEventRow> {
  const prev = pushQueues.get(taskId) ?? Promise.resolve();
  const next = prev
    .then(async () => {
      const row = await prisma.taskEvent.create({
        data: { taskId, type, data },
      });
      emitter.emit(`event:${taskId}`, row);
      return row;
    })
    .catch((err: unknown) => {
      // 写入失败也要发射事件，避免客户端永久等待
      const fallbackRow: TaskEventRow = {
        id: 2147483647, // INT4 max — safe fallback, 仅用于内存 emit
        taskId,
        type,
        data: data as Prisma.JsonValue,
        createdAt: new Date(),
      };
      emitter.emit(`event:${taskId}`, fallbackRow);
      // FK violation / record-not-found → task deleted by cascade, suppress
      if (isFkViolation(err) || isRecordNotFound(err)) {
        console.warn(`[task:${taskId}] pushEvent(${type}): task deleted, skipping`);
        return fallbackRow;
      }
      console.error(`[task:${taskId}] pushEvent(${type}) DB write failed:`, err);
      throw err; // 重新抛出，让调用方知道失败了
    });
  pushQueues.set(taskId, next);
  return next;
}

/* ------------------------------------------------------------------ */
/*  submitTask                                                         */
/* ------------------------------------------------------------------ */

export interface SubmitTaskInput {
  message: string;
  sessionId?: string;
  user?: string;
  images?: string[];
  /** LLM model id to use (validated against MODEL_OPTIONS). */
  model?: string;
  /** Optional agent configuration (context provider, preload MCPs, skills). */
  agentConfig?: AgentConfig;
  /** Optional pre-task initialization hook (e.g. ensureVideoSchema). */
  beforeRun?: () => Promise<void>;
}

export interface SubmitTaskResult {
  taskId: string;
  sessionId: string;
}

/**
 * Create a Task and start the agent loop in the background.
 * Returns immediately with the task and session IDs.
 *
 * Rejects if the session already has a pending/running task
 * to prevent duplicate submissions (defense in depth).
 */
export async function submitTask(
  input: SubmitTaskInput,
): Promise<SubmitTaskResult> {
  // We need a sessionId up-front for the Task FK.
  // runAgentStream will getOrCreate internally — but we need to pre-resolve
  // so we can store it on the Task before execution starts.
  const { getOrCreateSession } = await import(
    "@/lib/services/chat-session-service"
  );
  const session = await getOrCreateSession(input.sessionId, input.user);

  // Guard: reject if session already has an active task
  const existing = await getActiveTaskForSession(session.id);
  if (existing) {
    return { taskId: existing.id, sessionId: session.id };
  }

  const task = await prisma.task.create({
    data: {
      sessionId: session.id,
      status: "pending",
      input: {
        message: input.message,
        images: input.images ?? [],
      } satisfies Prisma.InputJsonValue as Prisma.InputJsonValue,
    },
  });

  // Fire-and-forget: start execution on next tick
  void executeTask(task.id, session.id, input);

  return { taskId: task.id, sessionId: session.id };
}

/* ------------------------------------------------------------------ */
/*  executeTask  (internal)                                            */
/* ------------------------------------------------------------------ */

async function executeTask(
  taskId: string,
  sessionId: string,
  input: SubmitTaskInput,
): Promise<void> {
  const ac = new AbortController();
  activeAborts.set(taskId, ac);
  let release: (() => void) | null = null;

  try {
    // --- Emit queued event + novel feed ---
    const queuePos = getQueuePosition(taskId);
    const concurrency = getConcurrencyStatus();
    await pushEvent(taskId, "queued", {
      position: queuePos >= 0 ? queuePos : 0,
      active: concurrency.active,
      max: concurrency.max,
    });
    const novelInfo = await resolveTaskNovelInfo(sessionId);
    emitNovelFeed({
      type: "task_queued",
      taskId,
      sessionId,
      scriptKey: novelInfo.scriptKey,
      novelId: novelInfo.novelId,
    });

    // --- Acquire concurrency permit (may wait in queue) ---
    const permit = await acquire(taskId, ac.signal);
    release = permit.release;

    // Run pre-task initialization if provided (e.g. ensureVideoSchema)
    if (input.beforeRun) {
      await input.beforeRun();
    }

    // --- Mark running ---
    await prisma.task.update({
      where: { id: taskId },
      data: { status: "running" },
    });
    emitNovelFeed({
      type: "task_started",
      taskId,
      sessionId,
      scriptKey: novelInfo.scriptKey,
      novelId: novelInfo.novelId,
    });

    // --- Start timeout timer (from running, not from creation) ---
    const timeoutTimer = setTimeout(() => {
      console.warn(`[task:${taskId}] Timeout after ${TASK_TIMEOUT_MS / 60_000}min, aborting`);
      ac.abort();
    }, TASK_TIMEOUT_MS);
    taskTimeouts.set(taskId, timeoutTimer);

    const callbacks: StreamCallbacks = {
      onSession: (id) => {
        pushEvent(taskId, "session", { session_id: id }).catch(() => {/* logged in pushEvent */});
      },
      onDelta: (text) => {
        pushEvent(taskId, "delta", { text }).catch(() => {/* logged in pushEvent */});
      },
      onToolCall: (call) => {
        pushEvent(taskId, "tool", { summary: summarizeTool(call) }).catch(() => {/* logged in pushEvent */});
      },
      onToolStart: (event) => {
        pushEvent(taskId, "tool_start", event as unknown as Prisma.InputJsonValue).catch(() => {/* logged in pushEvent */});
      },
      onToolEnd: (event) => {
        pushEvent(taskId, "tool_end", event as unknown as Prisma.InputJsonValue).catch(() => {/* logged in pushEvent */});
      },
      onProgress: (event) => {
        pushEvent(taskId, event.type, event.data as Prisma.InputJsonValue).catch(() => {/* logged in pushEvent */});
      },
      onUsage: (event) => {
        pushEvent(taskId, "usage", event as unknown as Prisma.InputJsonValue).catch(() => {/* logged in pushEvent */});
      },
      onUploadRequest: (req) => {
        pushEvent(taskId, "upload_request", req as Prisma.InputJsonValue).catch(() => {/* logged in pushEvent */});
      },
      onKeyResource: (resource: KeyResourceEvent) => {
        if (resource.persisted) {
          pushEvent(taskId, "key_resource", {
            id: resource.persisted.id,
            key: resource.key,
            mediaType: resource.mediaType,
            version: resource.persisted.version,
            url: resource.url ?? null,
            data: resource.data ?? null,
            title: resource.title ?? null,
          } as unknown as Prisma.InputJsonValue).catch(() => {/* logged in pushEvent */});
          return;
        }
        upsertResource("session", sessionId, resource.key, resource.mediaType, {
          title: resource.title,
          url: resource.url,
          data: resource.data as Prisma.InputJsonValue | undefined,
        })
          .then((row) => {
            return pushEvent(taskId, "key_resource", {
              id: row.id,
              key: resource.key,
              mediaType: resource.mediaType,
              version: row.version,
              url: resource.url ?? null,
              data: resource.data ?? null,
              title: resource.title ?? null,
            } as unknown as Prisma.InputJsonValue);
          })
          .catch((err) => {
            console.error(`[task:${taskId}] onKeyResource upsert failed:`, err);
            return pushEvent(taskId, "key_resource", resource as unknown as Prisma.InputJsonValue);
          })
          .catch(() => {/* logged in pushEvent */});
      },
    };

    const agentConfig: AgentConfig = {
      ...input.agentConfig,
      ...(input.model ? { model: input.model } : {}),
    };

    const result = await runAgentStream(
      input.message,
      sessionId,
      input.user,
      callbacks,
      ac.signal,
      input.images,
      agentConfig,
    );

    await terminateTask(taskId, sessionId, "completed", { reply: result.reply });
  } catch (err: unknown) {
    if (ac.signal.aborted) {
      await terminateTask(taskId, sessionId, "cancelled", { error: "Task cancelled" })
        .catch((e) => console.error(`[task:${taskId}] terminateTask(cancelled) failed:`, e));
    } else {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[task:${taskId}]`, err);
      await terminateTask(taskId, sessionId, "failed", { error: message })
        .catch((e) => console.error(`[task:${taskId}] terminateTask(failed) failed:`, e));
    }
  } finally {
    // Cleanup timeout timer
    const timer = taskTimeouts.get(taskId);
    if (timer) {
      clearTimeout(timer);
      taskTimeouts.delete(taskId);
    }
    activeAborts.delete(taskId);
    clearPushQueue(taskId);
    release?.();
  }
}

/* ------------------------------------------------------------------ */
/*  getTask                                                            */
/* ------------------------------------------------------------------ */

export interface TaskInfo {
  id: string;
  sessionId: string;
  status: string;
  reply: string | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export async function getTask(taskId: string): Promise<TaskInfo | null> {
  return prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      sessionId: true,
      status: true,
      reply: true,
      error: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

/**
 * Find the active (pending/running) task for a session, if any.
 */
export async function getActiveTaskForSession(
  sessionId: string,
): Promise<TaskInfo | null> {
  return prisma.task.findFirst({
    where: {
      sessionId,
      type: "agent",
      status: { in: ["pending", "running"] },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      sessionId: true,
      status: true,
      reply: true,
      error: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

/* ------------------------------------------------------------------ */
/*  cancelTask                                                         */
/* ------------------------------------------------------------------ */

export async function cancelTask(taskId: string): Promise<boolean> {
  // Try to remove from concurrency queue first (pending, not yet running)
  if (removeFromQueue(taskId)) {
    // The waiter's reject will cause executeTask to catch and terminate
    return true;
  }

  const ac = activeAborts.get(taskId);
  if (ac) {
    ac.abort();
    return true;
  }
  // Task may have already finished — update status if still active in DB
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { status: true, sessionId: true },
  });
  if (task && (task.status === "pending" || task.status === "running")) {
    await terminateTask(taskId, task.sessionId, "cancelled", { error: "Task cancelled" });
    return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/*  listTasksForNovel — novel-level task list                          */
/* ------------------------------------------------------------------ */

export interface NovelTaskInfo {
  id: string;
  sessionId: string;
  status: string;
  scriptKey: string | null;
  sessionTitle: string | null;
  reply: string | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * List tasks belonging to a novel (both active and recent).
 * Resolves via User.name pattern `video:{novelId}:*`.
 */
export async function listTasksForNovel(
  novelId: string,
  opts?: { limit?: number },
): Promise<NovelTaskInfo[]> {
  const limit = opts?.limit ?? 50;

  // Find all users matching video:{novelId}:* pattern
  const users = await prisma.user.findMany({
    where: {
      name: { startsWith: `video:${novelId}` },
    },
    select: { id: true, name: true },
  });

  if (users.length === 0) return [];

  const userIds = users.map((u) => u.id);
  const userNameMap = new Map(users.map((u) => [u.id, u.name]));

  const tasks = await prisma.task.findMany({
    where: {
      type: "agent",
      session: { userId: { in: userIds } },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      sessionId: true,
      status: true,
      reply: true,
      error: true,
      createdAt: true,
      updatedAt: true,
      session: {
        select: {
          title: true,
          userId: true,
        },
      },
    },
  });

  return tasks.map((t) => {
    const userName = userNameMap.get(t.session.userId) ?? "";
    const info = resolveNovelInfo(userName);
    return {
      id: t.id,
      sessionId: t.sessionId,
      status: t.status,
      scriptKey: info.scriptKey,
      sessionTitle: t.session.title,
      reply: t.reply,
      error: t.error,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    };
  });
}

/* ------------------------------------------------------------------ */
/*  subscribeNovelFeed — novel-level SSE                               */
/* ------------------------------------------------------------------ */

/**
 * Subscribe to novel-level task lifecycle events.
 * Yields NovelFeedEvents as they occur for the given novelId.
 */
export async function* subscribeNovelFeed(
  novelId: string,
  signal?: AbortSignal,
): AsyncGenerator<NovelFeedEvent> {
  const queue: NovelFeedEvent[] = [];
  let resolve: (() => void) | null = null;
  let ended = false;

  const onEvent = (event: NovelFeedEvent) => {
    queue.push(event);
    resolve?.();
  };
  const onAbort = () => {
    ended = true;
    resolve?.();
  };

  novelFeed.on(`novel:${novelId}`, onEvent);
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    while (!ended && !signal?.aborted) {
      if (queue.length > 0) {
        yield queue.shift()!;
      } else {
        await new Promise<void>((r) => { resolve = r; });
        resolve = null;
      }
    }
    // Drain
    while (queue.length > 0) {
      yield queue.shift()!;
    }
  } finally {
    novelFeed.off(`novel:${novelId}`, onEvent);
    signal?.removeEventListener("abort", onAbort);
  }
}

/* ------------------------------------------------------------------ */
/*  subscribeEvents  (AsyncGenerator for SSE)                          */
/* ------------------------------------------------------------------ */

/**
 * Subscribe to a task's event stream.
 *
 * 1. Replay persisted events with id > lastEventId from DB.
 * 2. Attach to in-memory EventEmitter for live events.
 * 3. Yields until the task ends or the signal is aborted.
 *
 * If the task is already finished, replays all events and returns.
 */
export async function* subscribeEvents(
  taskId: string,
  lastEventId?: number,
  signal?: AbortSignal,
): AsyncGenerator<TaskEventRow> {
  // --- Attach listener FIRST to avoid race condition ---
  // Any events emitted after this point are captured in the queue.
  // Events before this point are in the DB and will be replayed below.
  const queue: TaskEventRow[] = [];
  let resolve: (() => void) | null = null;
  let ended = false;
  let highestSeen = lastEventId ?? 0;

  const onEvent = (row: TaskEventRow) => {
    if (row.id <= highestSeen) return; // duplicate guard
    queue.push(row);
    resolve?.();
  };
  const onEnd = () => {
    ended = true;
    resolve?.();
  };
  const onAbort = () => {
    ended = true;
    resolve?.();
  };

  emitter.on(`event:${taskId}`, onEvent);
  emitter.on(`end:${taskId}`, onEnd);
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    // 1. Replay persisted events from DB
    const replayRows = await prisma.taskEvent.findMany({
      where: {
        taskId,
        ...(lastEventId != null ? { id: { gt: lastEventId } } : {}),
      },
      orderBy: { id: "asc" },
    });

    for (const row of replayRows) {
      highestSeen = row.id;
      yield row;
    }

    // 2. Check if task already finished (events captured by listener above)
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { status: true },
    });
    const isTerminal =
      !task ||
      task.status === "completed" ||
      task.status === "failed" ||
      task.status === "cancelled";

    // Drain any live events that arrived during replay
    while (queue.length > 0) {
      const row = queue.shift()!;
      highestSeen = row.id;
      yield row;
    }

    if (isTerminal) return;

    // 3. Wait for live events
    while (!ended && !signal?.aborted) {
      if (queue.length > 0) {
        const row = queue.shift()!;
        highestSeen = row.id;
        yield row;
      } else {
        await new Promise<void>((r) => {
          resolve = r;
        });
        resolve = null;
      }
    }
    // Drain remaining queued events
    while (queue.length > 0) {
      const row = queue.shift()!;
      yield row;
    }
  } finally {
    emitter.off(`event:${taskId}`, onEvent);
    emitter.off(`end:${taskId}`, onEnd);
    signal?.removeEventListener("abort", onAbort);
  }
}
