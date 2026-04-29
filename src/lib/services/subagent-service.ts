import { prisma } from "@/lib/db";
import { runAgentStream } from "@/lib/agent/agent";
import type { StreamCallbacks, KeyResourceEvent, AgentConfig } from "@/lib/agent/agent";
import type { ToolCall } from "@/lib/agent/types";
import { upsertResource } from "@/lib/services/key-resource-service";
import type { Prisma } from "@/generated/prisma";

/* ================================================================== */
/*  Types                                                              */
/* ================================================================== */

export interface SubAgentEventRow {
  id: number;
  subagentId: string;
  type: string;
  data: Prisma.JsonValue;
  createdAt: Date;
}

/** Sentinel emitted when a subagent reaches a terminal state. */
const SUBAGENT_END = Symbol("subagent-end");

/** Max nesting depth for subagent trees. */
export const MAX_SUBAGENT_DEPTH = 3;

/* ================================================================== */
/*  Simple EventEmitter implementation                                */
/* ================================================================== */

type EventHandler = (data?: SubAgentEventRow | symbol) => void;

class SimpleEventEmitter {
  private listeners = new Map<string, Set<EventHandler>>();

  on(event: string, handler: EventHandler): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);
  }

  off(event: string, handler: EventHandler): void {
    this.listeners.get(event)?.delete(handler);
  }

  emit(event: string, data?: SubAgentEventRow | symbol): void {
    this.listeners.get(event)?.forEach((handler) => handler(data));
  }
}

/* ================================================================== */
/*  In-memory state (survives Next.js HMR)                            */
/* ================================================================== */

const globalForSubAgent = globalThis as unknown as {
  __subagentEmitter?: SimpleEventEmitter;
  __subagentAborts?: Map<string, AbortController>;
};

/** Emits `event:<subagentId>` for live events, `end:<subagentId>` on finish. */
const emitter = (globalForSubAgent.__subagentEmitter ??= new SimpleEventEmitter());

/** Active subagents' AbortControllers, keyed by subagentId. */
const activeAborts = (globalForSubAgent.__subagentAborts ??= new Map());

/* ================================================================== */
/*  Helpers                                                            */
/* ================================================================== */

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


/**
 * Per-subagent serial queue for pushEvent.
 * Ensures events are written to DB and emitted in call order,
 * even when callbacks fire in rapid succession (e.g. tool_start → tool_end).
 */
const pushQueues = new Map<string, Promise<unknown>>();

function clearPushQueue(subagentId: string): void {
  pushQueues.delete(subagentId);
}

/** Persist a SubAgentEvent to DB and emit to in-memory subscribers. */
function pushEvent(
  subagentId: string,
  type: string,
  data: Prisma.InputJsonValue,
): Promise<SubAgentEventRow> {
  const prev = pushQueues.get(subagentId)?.catch(() => undefined) ?? Promise.resolve();
  const next = prev.then(async () => {
    try {
      const row = await prisma.subAgentEvent.create({
        data: { subagentId, type, data },
      });
      emitter.emit(`event:${subagentId}`, row);
      return row;
    } catch (err: unknown) {
      // 写入失败也要发射事件，避免客户端永久等待
      console.error(`[subagent:${subagentId}] pushEvent(${type}) DB write failed:`, err);
      const fallbackRow: SubAgentEventRow = {
        id: Date.now(), // 临时 ID，确保递增
        subagentId,
        type,
        data: data as Prisma.JsonValue,
        createdAt: new Date(),
      };
      emitter.emit(`event:${subagentId}`, fallbackRow);
      return fallbackRow;
    }
  });
  pushQueues.set(subagentId, next);
  return next;
}

/* ================================================================== */
/*  submitSubAgent                                                     */
/* ================================================================== */

export interface SubmitSubAgentInput {
  message: string;
  sessionId?: string;
  user?: string;
  images?: string[];
  /** Parent subagent ID (for nesting). */
  parentAgentId?: string;
  /** LLM model id to use (validated against MODEL_OPTIONS). */
  model?: string;
  /** Optional agent configuration (context provider, preload MCPs, skills). */
  agentConfig?: AgentConfig;
  /** Optional pre-subagent initialization hook (e.g. ensureVideoSchema). */
  beforeRun?: () => Promise<void>;
}

export interface SubmitSubAgentResult {
  subagentId: string;
  sessionId: string;
}

/**
 * Create a SubAgent and start the agent loop in the background.
 * Returns immediately with the subagent and session IDs.
 */
export async function submitSubAgent(
  input: SubmitSubAgentInput,
): Promise<SubmitSubAgentResult> {
  // We need a sessionId up-front for the SubAgent FK.
  // runAgentStream will getOrCreate internally — but we need to pre-resolve
  // so we can store it on the SubAgent before execution starts.
  const { getOrCreateSession } = await import(
    "@/lib/services/chat-session-service"
  );
  const session = await getOrCreateSession(input.sessionId, input.user);

  // Calculate depth
  let depth = 0;
  if (input.parentAgentId) {
    const parent = await prisma.subAgent.findUnique({
      where: { id: input.parentAgentId },
      select: { depth: true },
    });
    if (parent) {
      depth = parent.depth + 1;
      if (depth > MAX_SUBAGENT_DEPTH) {
        throw new Error(
          `SubAgent nesting depth exceeds maximum (${MAX_SUBAGENT_DEPTH})`,
        );
      }
    }
  }

  const subagent = await prisma.subAgent.create({
    data: {
      sessionId: session.id,
      parentAgentId: input.parentAgentId ?? null,
      depth,
      status: "pending",
      config: {
        message: input.message,
        images: input.images ?? [],
        model: input.model,
        agentConfig: input.agentConfig as Prisma.InputJsonValue | undefined,
      } as Prisma.InputJsonValue,
    },
  });

  // Fire-and-forget: start execution on next tick
  void executeSubAgent(subagent.id, session.id, subagent.depth, input).catch((err: unknown) => {
    console.error(`[subagent:${subagent.id}] background execution leaked error:`, err);
  });

  return { subagentId: subagent.id, sessionId: session.id };
}

/* ================================================================== */
/*  executeSubAgent (internal)                                         */
/* ================================================================== */

async function executeSubAgent(
  subagentId: string,
  sessionId: string,
  subagentDepth: number,
  input: SubmitSubAgentInput,
): Promise<void> {
  const ac = new AbortController();
  activeAborts.set(subagentId, ac);

  try {
    // Run pre-subagent initialization if provided (e.g. ensureVideoSchema)
    if (input.beforeRun) {
      await input.beforeRun();
    }

    await prisma.subAgent.update({
      where: { id: subagentId },
      data: { status: "running" },
    });

    const callbacks: StreamCallbacks = {
      onSession: (id) => {
        pushEvent(subagentId, "session", { session_id: id }).catch(() => {/* logged in pushEvent */});
      },
      onDelta: (text) => {
        pushEvent(subagentId, "delta", { text }).catch(() => {/* logged in pushEvent */});
      },
      onToolCall: (call) => {
        pushEvent(subagentId, "tool", { summary: summarizeTool(call) }).catch(() => {/* logged in pushEvent */});
      },
      onToolStart: (event) => {
        pushEvent(subagentId, "tool_start", event as unknown as Prisma.InputJsonValue).catch(() => {/* logged in pushEvent */});
      },
      onToolEnd: (event) => {
        pushEvent(subagentId, "tool_end", event as unknown as Prisma.InputJsonValue).catch(() => {/* logged in pushEvent */});
      },
      onUploadRequest: (req) => {
        pushEvent(subagentId, "upload_request", req as Prisma.InputJsonValue).catch(() => {/* logged in pushEvent */});
      },
      onKeyResource: (resource: KeyResourceEvent) => {
        if (resource.persisted) {
          // Already written by the MCP tool — just push SSE notification
          pushEvent(subagentId, "key_resource", {
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
        // Not yet persisted (e.g. subagent JSON) — write + notify
        upsertResource("session", sessionId, resource.key, resource.mediaType, {
          title: resource.title,
          url: resource.url,
          data: resource.data as Prisma.InputJsonValue | undefined,
        })
          .then((row) => {
            return pushEvent(subagentId, "key_resource", {
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
            console.error(`[subagent:${subagentId}] onKeyResource upsert failed:`, err);
            // Fallback: 至少发送未持久化的资源信息
            return pushEvent(subagentId, "key_resource", resource as unknown as Prisma.InputJsonValue);
          })
          .catch(() => {/* logged in pushEvent */});
      },
    };

    // Merge per-request model into agentConfig
    const agentConfig: AgentConfig = {
      ...input.agentConfig,
      ...(input.model ? { model: input.model } : {}),
      persistentSubAgentId: subagentId,
      subAgentDepth: subagentDepth,
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

    if (ac.signal.aborted) {
      await prisma.subAgent.update({
        where: { id: subagentId },
        data: {
          status: "cancelled",
          output: result.reply || null,
          error: "SubAgent cancelled",
        },
      });
      await pushEvent(subagentId, "error", { error: "SubAgent cancelled" });
    } else if (result.interruption) {
      await prisma.subAgent.update({
        where: { id: subagentId },
        data: {
          status: "interrupted",
          output: result.reply || null,
          error: result.interruption.reason,
        },
      });

      await pushEvent(subagentId, "interrupted", {
        session_id: result.sessionId,
        output: result.reply,
        error: result.interruption.reason,
        recoverable: result.interruption.recoverable,
        partial_saved: result.interruption.partialSaved,
        code: result.interruption.code ?? null,
      });
    } else {
      await prisma.subAgent.update({
        where: { id: subagentId },
        data: { status: "completed", output: result.reply },
      });

      await pushEvent(subagentId, "done", {
        session_id: result.sessionId,
        output: result.reply,
      });
    }
  } catch (err: unknown) {
    // Check if this was a cancellation
    if (ac.signal.aborted) {
      await prisma.subAgent.update({
        where: { id: subagentId },
        data: { status: "cancelled" },
      });
      await pushEvent(subagentId, "error", { error: "SubAgent cancelled" });
    } else {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[subagent:${subagentId}]`, err);
      await prisma.subAgent.update({
        where: { id: subagentId },
        data: { status: "failed", error: message },
      });
      await pushEvent(subagentId, "error", { error: message });
    }
  } finally {
    activeAborts.delete(subagentId);
    clearPushQueue(subagentId);
    emitter.emit(`end:${subagentId}`, SUBAGENT_END);
  }
}

/* ================================================================== */
/*  getSubAgent                                                        */
/* ================================================================== */

export interface SubAgentInfo {
  id: string;
  sessionId: string;
  parentAgentId: string | null;
  depth: number;
  status: string;
  output: string | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export async function getSubAgent(subagentId: string): Promise<SubAgentInfo | null> {
  return prisma.subAgent.findUnique({
    where: { id: subagentId },
    select: {
      id: true,
      sessionId: true,
      parentAgentId: true,
      depth: true,
      status: true,
      output: true,
      error: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

/**
 * Find the active (pending/running) subagent for a session, if any.
 */
export async function getActiveSubAgentForSession(
  sessionId: string,
): Promise<SubAgentInfo | null> {
  return prisma.subAgent.findFirst({
    where: {
      sessionId,
      status: { in: ["pending", "running"] },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      sessionId: true,
      parentAgentId: true,
      depth: true,
      status: true,
      output: true,
      error: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

/* ================================================================== */
/*  cancelSubAgent                                                     */
/* ================================================================== */

export async function cancelSubAgent(subagentId: string): Promise<boolean> {
  const ac = activeAborts.get(subagentId);
  if (ac) {
    ac.abort();
    return true;
  }
  // SubAgent may have already finished — update status if still active in DB
  const subagent = await prisma.subAgent.findUnique({
    where: { id: subagentId },
    select: { status: true },
  });
  if (subagent && (subagent.status === "pending" || subagent.status === "running")) {
    await prisma.subAgent.update({
      where: { id: subagentId },
      data: { status: "cancelled" },
    });
    await pushEvent(subagentId, "error", { error: "SubAgent cancelled" });
    emitter.emit(`end:${subagentId}`, SUBAGENT_END);
    return true;
  }
  return false;
}

/* ================================================================== */
/*  subscribeEvents (AsyncGenerator for SSE)                          */
/* ================================================================== */

/**
 * Subscribe to a subagent's event stream.
 *
 * 1. Replay persisted events with id > lastEventId from DB.
 * 2. Attach to in-memory EventEmitter for live events.
 * 3. Yields until the subagent ends or the signal is aborted.
 *
 * If the subagent is already finished, replays all events and returns.
 */
export async function* subscribeEvents(
  subagentId: string,
  lastEventId?: number,
  signal?: AbortSignal,
): AsyncGenerator<SubAgentEventRow> {
  // --- Attach listener FIRST to avoid race condition ---
  // Any events emitted after this point are captured in the queue.
  // Events before this point are in the DB and will be replayed below.
  const queue: SubAgentEventRow[] = [];
  let resolve: (() => void) | null = null;
  let ended = false;
  let highestSeen = lastEventId ?? 0;

  const onEvent = (data?: SubAgentEventRow | symbol) => {
    if (!data || typeof data === 'symbol') return;
    const row = data as SubAgentEventRow;
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

  emitter.on(`event:${subagentId}`, onEvent);
  emitter.on(`end:${subagentId}`, onEnd);
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    // 1. Replay persisted events from DB
    const replayRows = await prisma.subAgentEvent.findMany({
      where: {
        subagentId,
        ...(lastEventId != null ? { id: { gt: lastEventId } } : {}),
      },
      orderBy: { id: "asc" },
    });

    for (const row of replayRows) {
      highestSeen = row.id;
      yield row;
    }

    // 2. Check if subagent already finished (events captured by listener above)
    const subagent = await prisma.subAgent.findUnique({
      where: { id: subagentId },
      select: { status: true },
    });
    const isTerminal =
      !subagent ||
      subagent.status === "completed" ||
      subagent.status === "failed" ||
      subagent.status === "interrupted" ||
      subagent.status === "cancelled" ||
      subagent.status === "max_iterations";

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
    emitter.off(`event:${subagentId}`, onEvent);
    emitter.off(`end:${subagentId}`, onEnd);
    signal?.removeEventListener("abort", onAbort);
  }
}

/**
 * Update subagent status
 * Used by MCP layer to update status without direct DB access
 */
export async function updateSubAgentStatus(
  id: string,
  status: 'pending' | 'running' | 'completed' | 'failed' | 'interrupted' | 'cancelled' | 'max_iterations'
): Promise<void> {
  await prisma.subAgent.update({
    where: { id },
    data: { status },
  });
}
