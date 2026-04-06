"use client";

/**
 * useTaskStream — shared SSE task subscription infrastructure.
 *
 * Encapsulates the core state management, EventSource subscription,
 * session loading/reconnect, stopStreaming, and cleanup that both
 * useChat (general chatbox) and useVideoChat (video domain) need.
 *
 * Domain-specific behaviour is injected via callbacks:
 * - onSessionDetail: process session data after task completes
 * - onExtraEvent: handle domain-specific SSE events (tool_start, tool_end, etc.)
 * - onStreamEnd: cleanup after streaming ends
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentStatus } from "../StatusBadge";
import { fetchJson, isRecord } from "../client-utils";
import type {
  ChatMessage,
  KeyResourceItem,
  SessionDetail,
  UploadRequestPayload,
} from "../../types";

/* ------------------------------------------------------------------ */
/*  LLM Stats                                                          */
/* ------------------------------------------------------------------ */

export interface LlmStats {
  /** Accumulated prompt tokens across all LLM calls in this page session. */
  totalPromptTokens: number;
  /** Accumulated completion tokens. */
  totalCompletionTokens: number;
  /** Accumulated total tokens. */
  totalTokens: number;
  /** Accumulated cache-read input tokens. */
  totalCacheReadTokens: number;
  /** Number of LLM completion rounds. */
  llmCalls: number;
  /** Last call's prompt tokens — used for context usage %. */
  lastPromptTokens: number;
  /** Last call's cache-read tokens. */
  lastCacheReadTokens: number;
  /** Model context window size. */
  maxContextTokens: number;
  /** Current model id. */
  model: string;
  /** Total tool call invocations. */
  toolCallCount: number;
  /** Tool calls that succeeded (no error). */
  toolSuccessCount: number;
  /** Tool calls that failed. */
  toolErrorCount: number;
  /** Subagent tool call count. */
  subagentCallCount: number;
  /** Subagent calls that errored. */
  subagentErrorCount: number;
}

const INITIAL_STATS: LlmStats = {
  totalPromptTokens: 0,
  totalCompletionTokens: 0,
  totalTokens: 0,
  totalCacheReadTokens: 0,
  llmCalls: 0,
  lastPromptTokens: 0,
  lastCacheReadTokens: 0,
  maxContextTokens: 0,
  model: "",
  toolCallCount: 0,
  toolSuccessCount: 0,
  toolErrorCount: 0,
  subagentCallCount: 0,
  subagentErrorCount: 0,
};

/* ------------------------------------------------------------------ */
/*  Config                                                             */
/* ------------------------------------------------------------------ */

export interface TaskStreamCallbacks {
  onSessionCreated: (sessionId: string) => void;
  onRefreshNeeded: () => void;
  /** Called after session detail is fetched on task completion. */
  onSessionDetail?: (detail: SessionDetail) => void;
  /** Called for non-core SSE event types (tool_start, tool_end, etc.). */
  onExtraEvent?: (type: string, data: unknown) => void;
  /** Called after streaming ends (done or error), after base state cleanup. */
  onStreamEnd?: () => void;
}

/* ------------------------------------------------------------------ */
/*  Return type                                                        */
/* ------------------------------------------------------------------ */

/* ---- Subagent task progress types ---- */

export interface SubagentTaskInfo {
  index: number;
  /** Display text: prompt preview (single-shot) or instruction (tool-loop). */
  instruction: string;
  model: string;
  /** single-shot | tool-loop | continue */
  mode: string;
  status: "running" | "ok" | "error" | "completed" | "failed" | "max_iterations";
  currentTool: string | null;
  toolCallCount: number;
  durationMs?: number;
  agentId?: string;
}

export interface TaskStreamReturn {
  /* ---- Read state ---- */
  sessionId: string | undefined;
  messages: ChatMessage[];
  input: string;
  error: string | null;
  isSending: boolean;
  isStreaming: boolean;
  isLoadingSession: boolean;
  streamingReply: string | null;
  streamingTools: string[];
  subagentTasks: SubagentTaskInfo[];
  status: AgentStatus;
  keyResources: KeyResourceItem[];
  uploadDialog: UploadRequestPayload | null;
  llmStats: LlmStats;

  /* ---- State setters (needed by consuming hooks for domain logic) ---- */
  setSessionId: (id: string | undefined) => void;
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  setInput: (v: string) => void;
  setError: (v: string | null) => void;
  setIsSending: (v: boolean) => void;
  setStatus: (s: AgentStatus) => void;
  setKeyResources: React.Dispatch<React.SetStateAction<KeyResourceItem[]>>;
  setUploadDialog: (req: UploadRequestPayload | null) => void;

  /* ---- Refs ---- */
  sessionIdRef: React.RefObject<string | undefined>;
  activeSendRef: React.MutableRefObject<boolean>;

  /* ---- Actions ---- */
  connectToTask: (taskId: string, opts?: { isReconnect?: boolean }) => void;
  stopStreaming: () => void;
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export function useTaskStream(
  initialSessionId: string | undefined,
  callbacks: TaskStreamCallbacks,
): TaskStreamReturn {
  /* ---- State ---- */
  const [sessionId, setSessionId] = useState<string | undefined>(initialSessionId);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isLoadingSession, setIsLoadingSession] = useState(false);
  const [streamingReply, setStreamingReply] = useState<string | null>(null);
  const [streamingTools, setStreamingTools] = useState<string[]>([]);
  const [subagentTasks, setSubagentTasks] = useState<SubagentTaskInfo[]>([]);
  const [status, setStatus] = useState<AgentStatus>("idle");
  const [keyResources, setKeyResources] = useState<KeyResourceItem[]>([]);
  const [uploadDialog, setUploadDialog] = useState<UploadRequestPayload | null>(null);
  const [llmStats, setLlmStats] = useState<LlmStats>(INITIAL_STATS);

  /* ---- Refs ---- */
  const taskIdRef = useRef<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const sessionIdRef = useRef<string | undefined>(initialSessionId);
  const activeSendRef = useRef(false);
  const timeoutCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  /* ---- Callback refs (identity-stable) ---- */
  const cbRef = useRef(callbacks);
  cbRef.current = callbacks;

  /* ---- done → idle after 3s ---- */
  useEffect(() => {
    if (status !== "done") return;
    const t = setTimeout(() => setStatus("idle"), 3000);
    return () => clearTimeout(t);
  }, [status]);

  /* ---------------------------------------------------------------- */
  /*  EventSource SSE subscription                                     */
  /* ---------------------------------------------------------------- */

  const connectToTask = useCallback(
    (taskId: string, opts?: { isReconnect?: boolean }) => {
      eventSourceRef.current?.close();
      if (timeoutCheckIntervalRef.current) {
        clearInterval(timeoutCheckIntervalRef.current);
        timeoutCheckIntervalRef.current = null;
      }

      const isReconnect = opts?.isReconnect ?? false;
      if (!isReconnect) {
        setStreamingReply("");
        setStreamingTools([]);
        setSubagentTasks([]);
      }
      setIsStreaming(true);
      setIsSending(true);
      activeSendRef.current = true;
      setStatus("running");

      taskIdRef.current = taskId;
      const es = new EventSource(`/api/tasks/${taskId}/events`);
      eventSourceRef.current = es;

      // 连接超时检测：如果 90 秒内没有收到任何消息（包括心跳），则认为连接已死
      let lastMessageTime = Date.now();
      timeoutCheckIntervalRef.current = setInterval(() => {
        const elapsed = Date.now() - lastMessageTime;
        if (elapsed > 90000 && es.readyState === EventSource.OPEN) {
          console.error(`[task:${taskId}] No message received for ${elapsed}ms, considering connection dead`);
          if (timeoutCheckIntervalRef.current) {
            clearInterval(timeoutCheckIntervalRef.current);
            timeoutCheckIntervalRef.current = null;
          }
          es.close();
          eventSourceRef.current = null;
          taskIdRef.current = null;
          setIsStreaming(false);
          setIsSending(false);
          activeSendRef.current = false;
          setStreamingReply(null);
          setStreamingTools([]);
          setError("连接超时，请刷新页面重试");
          setStatus("error");
          cbRef.current.onStreamEnd?.();
        }
      }, 15000); // 每 15 秒检查一次

      // 更新最后消息时间的辅助函数
      const touchLastMessageTime = () => {
        lastMessageTime = Date.now();
      };

      // 心跳事件监听器 — 带状态校验
      es.addEventListener("heartbeat", (e: MessageEvent) => {
        touchLastMessageTime();
        // If heartbeat says task is terminal but we haven't received done/error,
        // reconcile by fetching session detail
        try {
          const data: unknown = JSON.parse(e.data as string);
          if (isRecord(data) && typeof data.status === "string") {
            const hbStatus = data.status as string;
            if ((hbStatus === "completed" || hbStatus === "failed" || hbStatus === "cancelled")
                && taskIdRef.current) {
              // Clean up connection state immediately
              if (timeoutCheckIntervalRef.current) {
                clearInterval(timeoutCheckIntervalRef.current);
                timeoutCheckIntervalRef.current = null;
              }
              es.close();
              eventSourceRef.current = null;
              taskIdRef.current = null;

              // Cleanup streaming UI — batched with setMessages to avoid flicker
              const finalStatus = hbStatus === "completed" ? "done" as const : "error" as const;
              const cleanupStreamingState = () => {
                setIsStreaming(false);
                setIsSending(false);
                activeSendRef.current = false;
                setStreamingReply(null);
                setStreamingTools([]);
                setSubagentTasks([]);
                setStatus(finalStatus);
                if (hbStatus !== "completed") {
                  setError("任务已终止，请查看任务监控面板");
                }
                cbRef.current.onStreamEnd?.();
              };

              // Task already terminated but we missed the event — reconcile
              const sid = sessionIdRef.current;
              if (sid) {
                void fetchJson<SessionDetail>(`/api/sessions/${sid}`)
                  .then((detail) => {
                    setMessages(detail.messages);
                    setKeyResources(detail.keyResources ?? []);
                    cbRef.current.onSessionDetail?.(detail);
                  })
                  .catch(() => { /* best effort */ })
                  .finally(() => cleanupStreamingState());
              } else {
                cleanupStreamingState();
              }
            }
          }
        } catch { /* ignore parse errors */ }
      });

      /* ---- Core events ---- */

      es.addEventListener("session", (e: MessageEvent) => {
        touchLastMessageTime();
        try {
          const data: unknown = JSON.parse(e.data as string);
          if (isRecord(data) && typeof data.session_id === "string") {
            setSessionId(data.session_id);
            sessionIdRef.current = data.session_id;
            cbRef.current.onSessionCreated(data.session_id);
          }
        } catch { /* ignore */ }
      });

      es.addEventListener("delta", (e: MessageEvent) => {
        touchLastMessageTime();
        try {
          const data: unknown = JSON.parse(e.data as string);
          if (isRecord(data) && typeof data.text === "string") {
            // Don't clear subagent/executor tasks on delta — let them persist
            // until replaced by a new batch or until streaming ends.
            setStreamingReply((prev) => (prev ?? "") + data.text);
          }
        } catch { /* ignore */ }
      });

      es.addEventListener("tool", (e: MessageEvent) => {
        touchLastMessageTime();
        try {
          const data: unknown = JSON.parse(e.data as string);
          if (isRecord(data) && typeof data.summary === "string") {
            setStreamingTools((prev) =>
              prev.includes(data.summary as string) ? prev : [...prev, data.summary as string],
            );
          }
        } catch { /* ignore */ }
      });

      es.addEventListener("upload_request", (e: MessageEvent) => {
        touchLastMessageTime();
        try {
          const data = JSON.parse(e.data as string) as UploadRequestPayload;
          if (data.uploadId && data.endpoint) {
            setUploadDialog(data);
            setStatus("needs_attention");
          }
        } catch { /* ignore */ }
      });

      es.addEventListener("key_resource", (e: MessageEvent) => {
        touchLastMessageTime();
        try {
          const data: unknown = JSON.parse(e.data as string);
          if (isRecord(data)) {
            const kr: KeyResourceItem = {
              id: typeof data.id === "string" ? data.id : crypto.randomUUID(),
              key: typeof data.key === "string" ? data.key : "",
              mediaType: typeof data.mediaType === "string" ? data.mediaType : "json",
              currentVersion: typeof data.version === "number" ? data.version : 1,
              url: typeof data.url === "string" ? data.url : null,
              data: data.data,
              title: typeof data.title === "string" ? data.title : null,
            };
            setKeyResources((prev) => {
              const idx = prev.findIndex((r) => r.id === kr.id);
              if (idx >= 0) {
                const next = [...prev];
                next[idx] = kr;
                return next;
              }
              return [...prev, kr];
            });
          }
        } catch { /* ignore */ }
      });

      /* ---- Subagent progress events (unified) ---- */

      es.addEventListener("subagent_tasks", (e: MessageEvent) => {
        touchLastMessageTime();
        try {
          const data: unknown = JSON.parse(e.data as string);
          if (isRecord(data) && Array.isArray(data.tasks)) {
            setSubagentTasks(
              (data.tasks as Array<Record<string, unknown>>).map((t) => ({
                index: typeof t.index === "number" ? t.index : 0,
                instruction: typeof t.instruction === "string" ? t.instruction : (typeof t.promptPreview === "string" ? t.promptPreview : ""),
                model: typeof t.model === "string" ? t.model : "",
                mode: typeof t.mode === "string" ? t.mode : "single-shot",
                status: "running" as const,
                currentTool: null,
                toolCallCount: 0,
              })),
            );
          }
        } catch { /* ignore */ }
      });

      es.addEventListener("subagent_step", (e: MessageEvent) => {
        touchLastMessageTime();
        try {
          const data: unknown = JSON.parse(e.data as string);
          if (isRecord(data) && typeof data.taskIndex === "number") {
            const idx = data.taskIndex;
            const tool = typeof data.tool === "string" ? data.tool : null;
            const action = data.action;
            setSubagentTasks((prev) =>
              prev.map((t) =>
                t.index === idx
                  ? {
                      ...t,
                      currentTool: action === "start" ? tool : null,
                      toolCallCount: action === "end" ? t.toolCallCount + 1 : t.toolCallCount,
                    }
                  : t,
              ),
            );
          }
        } catch { /* ignore */ }
      });

      es.addEventListener("subagent_task_done", (e: MessageEvent) => {
        touchLastMessageTime();
        try {
          const data: unknown = JSON.parse(e.data as string);
          if (isRecord(data) && typeof data.index === "number") {
            const idx = data.index;
            const status = typeof data.status === "string"
              ? data.status as SubagentTaskInfo["status"]
              : "failed";
            const durationMs = typeof data.durationMs === "number" ? data.durationMs : undefined;
            const toolCallCount = typeof data.toolCallCount === "number" ? data.toolCallCount : 0;
            const agentId = typeof data.agentId === "string" ? data.agentId : undefined;
            setSubagentTasks((prev) =>
              prev.map((t) =>
                t.index === idx
                  ? { ...t, status, durationMs, toolCallCount, currentTool: null, agentId }
                  : t,
              ),
            );
          }
        } catch { /* ignore */ }
      });

      /* ---- Usage event (LLM token stats) ---- */

      es.addEventListener("usage", (e: MessageEvent) => {
        touchLastMessageTime();
        try {
          const data: unknown = JSON.parse(e.data as string);
          if (isRecord(data)) {
            const cacheRead = typeof data.cacheReadTokens === "number" ? data.cacheReadTokens : 0;
            setLlmStats((prev) => ({
              ...prev,
              totalPromptTokens: prev.totalPromptTokens + (typeof data.promptTokens === "number" ? data.promptTokens : 0),
              totalCompletionTokens: prev.totalCompletionTokens + (typeof data.completionTokens === "number" ? data.completionTokens : 0),
              totalTokens: prev.totalTokens + (typeof data.totalTokens === "number" ? data.totalTokens : 0),
              totalCacheReadTokens: prev.totalCacheReadTokens + cacheRead,
              llmCalls: prev.llmCalls + 1,
              lastPromptTokens: typeof data.promptTokens === "number" ? data.promptTokens : prev.lastPromptTokens,
              lastCacheReadTokens: cacheRead,
              maxContextTokens: typeof data.maxContextTokens === "number" ? data.maxContextTokens : prev.maxContextTokens,
              model: typeof data.model === "string" ? data.model : prev.model,
            }));
          }
        } catch { /* ignore */ }
      });

      /* ---- Extension: domain-specific events ---- */

      es.addEventListener("tool_start", (e: MessageEvent) => {
        touchLastMessageTime();
        try {
          const data: unknown = JSON.parse(e.data as string);
          if (isRecord(data) && typeof data.name === "string") {
            setLlmStats((prev) => {
              const isSubagent = (data.name as string).startsWith("subagent");
              return {
                ...prev,
                toolCallCount: prev.toolCallCount + 1,
                subagentCallCount: isSubagent ? prev.subagentCallCount + 1 : prev.subagentCallCount,
              };
            });
          }
          cbRef.current.onExtraEvent?.("tool_start", data);
        } catch { /* ignore */ }
      });

      es.addEventListener("tool_end", (e: MessageEvent) => {
        touchLastMessageTime();
        try {
          const data: unknown = JSON.parse(e.data as string);
          if (isRecord(data)) {
            const hasError = typeof data.error === "string";
            const isSubagent = typeof data.name === "string" && (data.name as string).startsWith("subagent");
            setLlmStats((prev) => ({
              ...prev,
              toolSuccessCount: hasError ? prev.toolSuccessCount : prev.toolSuccessCount + 1,
              toolErrorCount: hasError ? prev.toolErrorCount + 1 : prev.toolErrorCount,
              subagentErrorCount: isSubagent && hasError ? prev.subagentErrorCount + 1 : prev.subagentErrorCount,
            }));
          }
          cbRef.current.onExtraEvent?.("tool_end", data);
        } catch { /* ignore */ }
      });

      /* ---- done ---- */

      es.addEventListener("done", () => {
        touchLastMessageTime();
        if (timeoutCheckIntervalRef.current) {
          clearInterval(timeoutCheckIntervalRef.current);
          timeoutCheckIntervalRef.current = null;
        }
        es.close();
        eventSourceRef.current = null;
        taskIdRef.current = null;
        cbRef.current.onRefreshNeeded();

        // Cleanup streaming UI state — must be batched with setMessages to
        // avoid a flash where the streaming reply disappears before the
        // final messages arrive.
        const cleanupStreamingState = () => {
          setIsStreaming(false);
          setIsSending(false);
          activeSendRef.current = false;
          setStreamingReply(null);
          setStreamingTools([]);
          setSubagentTasks([]);
          setStatus("done");
          cbRef.current.onStreamEnd?.();
        };

        // Reload full session to get final state, then clear streaming UI
        // in the same React batch to prevent flicker.
        const sid = sessionIdRef.current;
        if (sid) {
          void fetchJson<SessionDetail>(`/api/sessions/${sid}`)
            .then((detail) => {
              setMessages(detail.messages);
              setKeyResources(detail.keyResources ?? []);
              cbRef.current.onSessionDetail?.(detail);
            })
            .catch(() => { /* best effort */ })
            .finally(() => cleanupStreamingState());
        } else {
          cleanupStreamingState();
        }
      });

      /* ---- error ---- */

      es.addEventListener("error", (e: Event) => {
        console.log(`[task:${taskId}] EventSource error event:`, e);
        
        // 处理服务端发送的错误事件 (MessageEvent with data)
        if (e instanceof MessageEvent && e.data) {
          touchLastMessageTime();
          if (timeoutCheckIntervalRef.current) {
            clearInterval(timeoutCheckIntervalRef.current);
            timeoutCheckIntervalRef.current = null;
          }
          try {
            const data: unknown = JSON.parse(e.data as string);
            if (isRecord(data) && typeof data.error === "string") {
              setError(data.error);
            }
          } catch { /* ignore */ }
          es.close();
          eventSourceRef.current = null;
          taskIdRef.current = null;
          setIsStreaming(false);
          setIsSending(false);
          activeSendRef.current = false;
          setStreamingReply(null);
          setStreamingTools([]);
          setSubagentTasks([]);
          setStatus("error");
          cbRef.current.onStreamEnd?.();
          return;
        }
        
        // 处理连接错误 (readyState === 0 or 2)
        if (es.readyState === EventSource.CLOSED) {
          console.error(`[task:${taskId}] EventSource connection closed unexpectedly`);
          if (timeoutCheckIntervalRef.current) {
            clearInterval(timeoutCheckIntervalRef.current);
            timeoutCheckIntervalRef.current = null;
          }
          es.close();
          eventSourceRef.current = null;
          taskIdRef.current = null;
          setIsStreaming(false);
          setIsSending(false);
          activeSendRef.current = false;
          setStreamingReply(null);
          setStreamingTools([]);
          setSubagentTasks([]);
          setError("连接中断，请刷新页面重试");
          setStatus("error");
          cbRef.current.onStreamEnd?.();
        }
        // 其他情况 (readyState === CONNECTING): EventSource 会自动重连 via Last-Event-ID
      });
    },
    [],
  );

  /* ---------------------------------------------------------------- */
  /*  Load initial session (with active task reconnect)                */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    if (!initialSessionId) return;
    if (activeSendRef.current) return;
    setIsLoadingSession(true);
    fetchJson<SessionDetail>(`/api/sessions/${initialSessionId}`)
      .then((data) => {
        setSessionId(data.id);
        setMessages(data.messages);
        setKeyResources(data.keyResources ?? []);
        cbRef.current.onSessionDetail?.(data);

        // Reconnect to active task if one exists
        if (
          data.activeTask &&
          (data.activeTask.status === "pending" || data.activeTask.status === "running")
        ) {
          connectToTask(data.activeTask.id, { isReconnect: true });
        }
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : "Failed to load session.";
        setError(msg);
      })
      .finally(() => setIsLoadingSession(false));
  }, [initialSessionId, connectToTask]);

  /* ---------------------------------------------------------------- */
  /*  stopStreaming                                                     */
  /* ---------------------------------------------------------------- */

  const stopStreaming = useCallback(() => {
    const tid = taskIdRef.current;
    if (tid) {
      void fetch(`/api/tasks/${tid}/cancel`, { method: "POST" }).catch(() => {});
    }
    if (timeoutCheckIntervalRef.current) {
      clearInterval(timeoutCheckIntervalRef.current);
      timeoutCheckIntervalRef.current = null;
    }
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    taskIdRef.current = null;

    // Mark streaming as stopped immediately for responsive UI,
    // but keep streamingReply visible until session data arrives
    // to prevent the message from briefly disappearing.
    setIsStreaming(false);
    setIsSending(false);
    activeSendRef.current = false;

    const cleanupStreamingUI = () => {
      setStreamingReply(null);
      setStreamingTools([]);
      setSubagentTasks([]);
      setStatus("idle");
      cbRef.current.onStreamEnd?.();
    };

    // Reload session to get persisted state after cancellation
    const sid = sessionIdRef.current;
    if (sid) {
      void fetchJson<SessionDetail>(`/api/sessions/${sid}`)
        .then((data) => {
          setMessages(data.messages);
          setKeyResources(data.keyResources ?? []);
        })
        .catch(() => {})
        .finally(() => cleanupStreamingUI());
    } else {
      cleanupStreamingUI();
    }
  }, []);

  /* ---------------------------------------------------------------- */
  /*  Cleanup on unmount                                               */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    return () => {
      if (timeoutCheckIntervalRef.current) {
        clearInterval(timeoutCheckIntervalRef.current);
        timeoutCheckIntervalRef.current = null;
      }
      eventSourceRef.current?.close();
    };
  }, []);

  /* ---------------------------------------------------------------- */
  /*  Return                                                           */
  /* ---------------------------------------------------------------- */

  return {
    sessionId,
    messages,
    input,
    error,
    isSending,
    isStreaming,
    isLoadingSession,
    streamingReply,
    streamingTools,
    subagentTasks,
    status,
    keyResources,
    uploadDialog,
    llmStats,

    setSessionId,
    setMessages,
    setInput,
    setError,
    setIsSending,
    setStatus,
    setKeyResources,
    setUploadDialog,

    sessionIdRef,
    activeSendRef,

    connectToTask,
    stopStreaming,
  };
}
