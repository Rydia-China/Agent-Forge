import { prisma } from "@/lib/db";
import { EventEmitter } from "node:events";
import { runAgentStream } from "@/lib/agent/agent";
import type { StreamCallbacks, KeyResourceEvent } from "@/lib/agent/agent";
import type { ToolCall } from "@/lib/agent/types";
import { addKeyResource } from "@/lib/services/key-resource-service";
import { requestContext } from "@/lib/request-context";
import type { Prisma } from "@/generated/prisma";

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
};

/** Emits `event:<taskId>` for live events, `end:<taskId>` on finish. */
const emitter = (globalForTask.__taskEmitter ??= (() => {
  const e = new EventEmitter();
  e.setMaxListeners(0);
  return e;
})());

/** Active tasks' AbortControllers, keyed by taskId. */
const activeAborts = (globalForTask.__taskAborts ??= new Map());

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function summarizeTool(call: ToolCall): string {
  if (call.function.name.startsWith("skills__")) {
    try {
      const parsed: unknown = JSON.parse(call.function.arguments);
      if (typeof parsed === "object" && parsed !== null) {
        const name = (parsed as Record<string, unknown>).name;
        if (typeof name === "string" && name.trim().length > 0) {
          return `使用了 skill：${name}`;
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
  const next = prev.then(async () => {
    const row = await prisma.taskEvent.create({
      data: { taskId, type, data },
    });
    emitter.emit(`event:${taskId}`, row);
    return row;
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
}

export interface SubmitTaskResult {
  taskId: string;
  sessionId: string;
}

/**
 * Create a Task and start the agent loop in the background.
 * Returns immediately with the task and session IDs.
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

  try {
    await prisma.task.update({
      where: { id: taskId },
      data: { status: "running" },
    });

    const callbacks: StreamCallbacks = {
      onSession: (id) => {
        void pushEvent(taskId, "session", { session_id: id });
      },
      onDelta: (text) => {
        void pushEvent(taskId, "delta", { text });
      },
      onToolCall: (call) => {
        void pushEvent(taskId, "tool", { summary: summarizeTool(call) });
      },
      onToolStart: (event) => {
        void pushEvent(taskId, "tool_start", event as unknown as Prisma.InputJsonValue);
      },
      onToolEnd: (event) => {
        void pushEvent(taskId, "tool_end", event as unknown as Prisma.InputJsonValue);
      },
      onUploadRequest: (req) => {
        void pushEvent(taskId, "upload_request", req as Prisma.InputJsonValue);
      },
      onKeyResource: (resource: KeyResourceEvent) => {
        if (resource.mediaType === "json") {
          // JSON → persist to DB (source of truth), then emit SSE
          void addKeyResource(sessionId, {
            mediaType: resource.mediaType,
            data: resource.data as Prisma.InputJsonValue | undefined,
            title: resource.title,
          })
            .then((row) => {
              void pushEvent(taskId, "key_resource", {
                ...resource,
                id: row.id,
              } as unknown as Prisma.InputJsonValue);
            })
            .catch(() => {
              void pushEvent(taskId, "key_resource", resource as unknown as Prisma.InputJsonValue);
            });
        } else {
          // Media → SSE only, derived from messages on re-fetch
          void pushEvent(taskId, "key_resource", resource as unknown as Prisma.InputJsonValue);
        }
      },
    };

    const result = await requestContext.run(
      { userName: input.user, sessionId },
      () =>
        runAgentStream(
          input.message,
          sessionId,
          input.user,
          callbacks,
          ac.signal,
          input.images,
        ),
    );

    await prisma.task.update({
      where: { id: taskId },
      data: { status: "completed", reply: result.reply },
    });

    await pushEvent(taskId, "done", {
      session_id: result.sessionId,
      reply: result.reply,
    });
  } catch (err: unknown) {
    // Check if this was a cancellation
    if (ac.signal.aborted) {
      await prisma.task.update({
        where: { id: taskId },
        data: { status: "cancelled" },
      });
      await pushEvent(taskId, "error", { error: "Task cancelled" });
    } else {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[task:${taskId}]`, err);
      await prisma.task.update({
        where: { id: taskId },
        data: { status: "failed", error: message },
      });
      await pushEvent(taskId, "error", { error: message });
    }
  } finally {
    activeAborts.delete(taskId);
    clearPushQueue(taskId);
    emitter.emit(`end:${taskId}`, TASK_END);
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
  const ac = activeAborts.get(taskId);
  if (ac) {
    ac.abort();
    return true;
  }
  // Task may have already finished — update status if still active in DB
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { status: true },
  });
  if (task && (task.status === "pending" || task.status === "running")) {
    await prisma.task.update({
      where: { id: taskId },
      data: { status: "cancelled" },
    });
    await pushEvent(taskId, "error", { error: "Task cancelled" });
    emitter.emit(`end:${taskId}`, TASK_END);
    return true;
  }
  return false;
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
