/**
 * Video Task Service — task submission for video workflow sessions.
 *
 * Parallels the core task-service but uses the video agent runner
 * (which has per-iteration context refresh). Reuses the same Task/TaskEvent
 * Prisma models for SSE compatibility — the existing frontend event system
 * works unchanged.
 */

import { prisma } from "@/lib/db";
import { EventEmitter } from "node:events";
import { runVideoAgentStream, type VideoAgentConfig } from "./agent-runner";
import { VideoContextProvider, type VideoContextConfig } from "./context-provider";
import type { StreamCallbacks, KeyResourceEvent } from "@/lib/agent/agent";
import type { ToolCall } from "@/lib/agent/types";
import { addKeyResource } from "@/lib/services/key-resource-service";
import { requestContext } from "@/lib/request-context";
import type { Prisma } from "@/generated/prisma";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface VideoTaskInput {
  message: string;
  sessionId?: string;
  user?: string;
  images?: string[];
  /** Video workflow context configuration. */
  videoContext: VideoContextConfig;
  /** MCPs to pre-load. */
  preloadMcps?: string[];
  /** Skills to inject into system prompt. */
  skills?: string[];
}

export interface VideoTaskResult {
  taskId: string;
  sessionId: string;
}

/* ------------------------------------------------------------------ */
/*  In-memory state — share with core task-service so SSE works        */
/* ------------------------------------------------------------------ */

const globalForTask = globalThis as unknown as {
  __taskEmitter?: EventEmitter;
  __taskAborts?: Map<string, AbortController>;
};

const emitter = (globalForTask.__taskEmitter ??= (() => {
  const e = new EventEmitter();
  e.setMaxListeners(0);
  return e;
})());

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
    } catch { /* ignore */ }
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

function pushEvent(
  taskId: string,
  type: string,
  data: Prisma.InputJsonValue,
): Promise<void> {
  const prev = pushQueues.get(taskId) ?? Promise.resolve();
  const next = prev.then(async () => {
    const row = await prisma.taskEvent.create({
      data: { taskId, type, data },
    });
    emitter.emit(`event:${taskId}`, row);
  });
  pushQueues.set(taskId, next);
  return next;
}

/* ------------------------------------------------------------------ */
/*  submitVideoTask                                                    */
/* ------------------------------------------------------------------ */

export async function submitVideoTask(
  input: VideoTaskInput,
): Promise<VideoTaskResult> {
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
        videoContext: input.videoContext as unknown as Prisma.InputJsonValue,
      } as Prisma.InputJsonValue,
    },
  });

  void executeVideoTask(task.id, session.id, input);

  return { taskId: task.id, sessionId: session.id };
}

/* ------------------------------------------------------------------ */
/*  executeVideoTask (internal)                                        */
/* ------------------------------------------------------------------ */

async function executeVideoTask(
  taskId: string,
  sessionId: string,
  input: VideoTaskInput,
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
        // Persist all resource types (image/video/json) to DB, then emit SSE
        void addKeyResource(sessionId, {
          mediaType: resource.mediaType,
          url: resource.url,
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
      },
    };

    // Build video agent config
    const contextProvider = new VideoContextProvider(input.videoContext);

    const agentConfig: VideoAgentConfig = {
      preloadMcps: input.preloadMcps,
      skills: input.skills,
      contextProvider,
    };

    const result = await requestContext.run(
      { userName: input.user, sessionId },
      () =>
        runVideoAgentStream(
          input.message,
          sessionId,
          input.user,
          agentConfig,
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
    if (ac.signal.aborted) {
      await prisma.task.update({
        where: { id: taskId },
        data: { status: "cancelled" },
      });
      await pushEvent(taskId, "error", { error: "Task cancelled" });
    } else {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[video-task:${taskId}]`, err);
      await prisma.task.update({
        where: { id: taskId },
        data: { status: "failed", error: message },
      });
      await pushEvent(taskId, "error", { error: message });
    }
  } finally {
    activeAborts.delete(taskId);
    clearPushQueue(taskId);
    emitter.emit(`end:${taskId}`);
  }
}

/* ------------------------------------------------------------------ */
/*  cancelVideoTask                                                    */
/* ------------------------------------------------------------------ */

export async function cancelVideoTask(taskId: string): Promise<boolean> {
  const ac = activeAborts.get(taskId);
  if (ac) {
    ac.abort();
    return true;
  }
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
    emitter.emit(`end:${taskId}`);
    return true;
  }
  return false;
}
