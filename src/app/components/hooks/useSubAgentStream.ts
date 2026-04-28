"use client";

/**
 * useSubAgentStream — shared SSE task subscription infrastructure.
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
/*  Config                                                             */
/* ------------------------------------------------------------------ */

export interface SubAgentStreamCallbacks {
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

export interface SubAgentStreamReturn {
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
  status: AgentStatus;
  keyResources: KeyResourceItem[];
  uploadDialog: UploadRequestPayload | null;

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
  connectToSubAgent: (subagentId: string, opts?: { isReconnect?: boolean }) => void;
  stopStreaming: () => void;
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export function useSubAgentStream(
  initialSessionId: string | undefined,
  callbacks: SubAgentStreamCallbacks,
): SubAgentStreamReturn {
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
  const [status, setStatus] = useState<AgentStatus>("idle");
  const [keyResources, setKeyResources] = useState<KeyResourceItem[]>([]);
  const [uploadDialog, setUploadDialog] = useState<UploadRequestPayload | null>(null);

  /* ---- Refs ---- */
  const subagentIdRef = useRef<string | null>(null);
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

  const connectToSubAgent = useCallback(
    (subagentId: string, opts?: { isReconnect?: boolean }) => {
      eventSourceRef.current?.close();
      if (timeoutCheckIntervalRef.current) {
        clearInterval(timeoutCheckIntervalRef.current);
        timeoutCheckIntervalRef.current = null;
      }

      const isReconnect = opts?.isReconnect ?? false;
      if (!isReconnect) {
        setStreamingReply("");
        setStreamingTools([]);
      }
      setIsStreaming(true);
      setIsSending(true);
      activeSendRef.current = true;
      setStatus("running");

      subagentIdRef.current = subagentId;
      const es = new EventSource(`/api/subagents/${subagentId}/events`);
      eventSourceRef.current = es;
      const clearTimeoutCheck = () => {
        if (timeoutCheckIntervalRef.current) {
          clearInterval(timeoutCheckIntervalRef.current);
          timeoutCheckIntervalRef.current = null;
        }
      };

      const closeEventSource = () => {
        clearTimeoutCheck();
        es.close();
        if (eventSourceRef.current === es) {
          eventSourceRef.current = null;
        }
        subagentIdRef.current = null;
      };

      const reloadSessionDetail = (clearStreamingOnSuccess: boolean) => {
        const sid = sessionIdRef.current;
        if (!sid) return;
        void fetchJson<SessionDetail>(`/api/sessions/${sid}`)
          .then((detail) => {
            setMessages(detail.messages);
            setKeyResources(detail.keyResources ?? []);
            cbRef.current.onSessionDetail?.(detail);
            if (clearStreamingOnSuccess) {
              setStreamingReply(null);
              setStreamingTools([]);
            }
          })
          .catch(() => { /* best effort */ });
      };

      const finishRecoverableInterruption = (message: string) => {
        closeEventSource();
        cbRef.current.onRefreshNeeded();
        setIsStreaming(false);
        setIsSending(false);
        activeSendRef.current = false;
        setError(message);
        setStatus("error");
        reloadSessionDetail(true);
        cbRef.current.onStreamEnd?.();
      };

      // 连接超时检测：如果 90 秒内没有收到任何消息（包括心跳），则认为连接已死
      let lastMessageTime = Date.now();
      timeoutCheckIntervalRef.current = setInterval(() => {
        const elapsed = Date.now() - lastMessageTime;
        if (elapsed > 90000 && es.readyState === EventSource.OPEN) {
          console.error(`[subagent:${subagentId}] No message received for ${elapsed}ms, considering connection dead`);
          closeEventSource();
          setIsStreaming(false);
          setIsSending(false);
          activeSendRef.current = false;
          setError("连接超时，后台任务可能仍在运行；稍后重新打开会话会自动恢复进度。");
          setStatus("error");
          cbRef.current.onStreamEnd?.();
        }
      }, 15000); // 每 15 秒检查一次

      // 更新最后消息时间的辅助函数
      const touchLastMessageTime = () => {
        lastMessageTime = Date.now();
      };

      // 心跳事件监听器
      es.addEventListener("heartbeat", () => {
        touchLastMessageTime();
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

      /* ---- Extension: domain-specific events ---- */

      es.addEventListener("tool_start", (e: MessageEvent) => {
        touchLastMessageTime();
        try {
          const data: unknown = JSON.parse(e.data as string);
          cbRef.current.onExtraEvent?.("tool_start", data);
        } catch { /* ignore */ }
      });

      es.addEventListener("tool_end", (e: MessageEvent) => {
        touchLastMessageTime();
        try {
          const data: unknown = JSON.parse(e.data as string);
          cbRef.current.onExtraEvent?.("tool_end", data);
        } catch { /* ignore */ }
      });
      /* ---- interrupted ---- */

      es.addEventListener("interrupted", (e: MessageEvent) => {
        touchLastMessageTime();
        let message = "LLM 网络中断，已保存上下文，可继续发送下一条消息。";
        try {
          const data: unknown = JSON.parse(e.data as string);
          if (isRecord(data) && typeof data.error === "string") {
            message = data.error;
          }
        } catch { /* ignore */ }
        finishRecoverableInterruption(message);
      });

      /* ---- done ---- */

      es.addEventListener("done", () => {
        touchLastMessageTime();
        closeEventSource();
        cbRef.current.onRefreshNeeded();

        // Reload full session to get final state
        reloadSessionDetail(false);

        setIsStreaming(false);
        setIsSending(false);
        activeSendRef.current = false;
        setStreamingReply(null);
        setStreamingTools([]);
        setStatus("done");
        cbRef.current.onStreamEnd?.();
      });

      /* ---- error ---- */

      es.addEventListener("error", (e: Event) => {
        console.log(`[subagent:${subagentId}] EventSource error event:`, e);
        
        // 处理服务端发送的错误事件 (MessageEvent with data)
        if (e instanceof MessageEvent && e.data) {
          touchLastMessageTime();
          clearTimeoutCheck();
          let recoverable = false;
          let recoverableMessage = "LLM 网络中断，已保存上下文，可继续发送下一条消息。";
          try {
            const data: unknown = JSON.parse(e.data as string);
            if (isRecord(data) && typeof data.error === "string") {
              setError(data.error);
              recoverableMessage = data.error;
            }
            if (isRecord(data) && data.recoverable === true) {
              recoverable = true;
            }
          } catch { /* ignore */ }
          if (recoverable) {
            finishRecoverableInterruption(recoverableMessage);
            return;
          }
          closeEventSource();
          setIsStreaming(false);
          setIsSending(false);
          activeSendRef.current = false;
          setStreamingReply(null);
          setStreamingTools([]);
          setStatus("error");
          cbRef.current.onStreamEnd?.();
          return;
        }
        
        // 处理连接错误 (readyState === 0 or 2)
        if (es.readyState === EventSource.CLOSED) {
          console.error(`[subagent:${subagentId}] EventSource connection closed unexpectedly`);
          closeEventSource();
          setIsStreaming(false);
          setIsSending(false);
          activeSendRef.current = false;
          setError("连接中断，后台任务可能仍在运行；重新打开会话会自动恢复进度。");
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

        // Reconnect to active subagent if one exists
        const activeSubAgent = data.activeSubAgent ?? data.activeTask;
        if (
          activeSubAgent &&
          (activeSubAgent.status === "pending" || activeSubAgent.status === "running")
        ) {
          connectToSubAgent(activeSubAgent.id, { isReconnect: true });
        }
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : "Failed to load session.";
        setError(msg);
      })
      .finally(() => setIsLoadingSession(false));
  }, [initialSessionId, connectToSubAgent]);

  /* ---------------------------------------------------------------- */
  /*  stopStreaming                                                     */
  /* ---------------------------------------------------------------- */

  const stopStreaming = useCallback(() => {
    const tid = subagentIdRef.current;
    if (tid) {
      void fetch(`/api/subagents/${tid}/cancel`, { method: "POST" }).catch(() => {});
    }
    if (timeoutCheckIntervalRef.current) {
      clearInterval(timeoutCheckIntervalRef.current);
      timeoutCheckIntervalRef.current = null;
    }
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    subagentIdRef.current = null;
    setIsStreaming(false);
    setIsSending(false);
    activeSendRef.current = false;
    setStreamingReply(null);
    setStreamingTools([]);

    // Reload session to get persisted state after cancellation
    const sid = sessionIdRef.current;
    if (sid) {
      void fetchJson<SessionDetail>(`/api/sessions/${sid}`)
        .then((data) => {
          setMessages(data.messages);
          setKeyResources(data.keyResources ?? []);
        })
        .catch(() => {});
    }
    setStatus("idle");
    cbRef.current.onStreamEnd?.();
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
    status,
    keyResources,
    uploadDialog,

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

    connectToSubAgent,
    stopStreaming,
  };
}
