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
  const [status, setStatus] = useState<AgentStatus>("idle");
  const [keyResources, setKeyResources] = useState<KeyResourceItem[]>([]);
  const [uploadDialog, setUploadDialog] = useState<UploadRequestPayload | null>(null);

  /* ---- Refs ---- */
  const taskIdRef = useRef<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const sessionIdRef = useRef<string | undefined>(initialSessionId);
  const activeSendRef = useRef(false);

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

      const isReconnect = opts?.isReconnect ?? false;
      if (!isReconnect) {
        setStreamingReply("");
        setStreamingTools([]);
      }
      setIsStreaming(true);
      setIsSending(true);
      activeSendRef.current = true;
      setStatus("running");

      taskIdRef.current = taskId;
      const es = new EventSource(`/api/tasks/${taskId}/events`);
      eventSourceRef.current = es;

      /* ---- Core events ---- */

      es.addEventListener("session", (e: MessageEvent) => {
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
        try {
          const data: unknown = JSON.parse(e.data as string);
          if (isRecord(data) && typeof data.text === "string") {
            setStreamingReply((prev) => (prev ?? "") + data.text);
          }
        } catch { /* ignore */ }
      });

      es.addEventListener("tool", (e: MessageEvent) => {
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
        try {
          const data = JSON.parse(e.data as string) as UploadRequestPayload;
          if (data.uploadId && data.endpoint) {
            setUploadDialog(data);
            setStatus("needs_attention");
          }
        } catch { /* ignore */ }
      });

      es.addEventListener("key_resource", (e: MessageEvent) => {
        try {
          const data: unknown = JSON.parse(e.data as string);
          if (isRecord(data)) {
            const kr: KeyResourceItem = {
              id: typeof data.id === "string" ? data.id : crypto.randomUUID(),
              mediaType: typeof data.mediaType === "string" ? data.mediaType : "json",
              url: typeof data.url === "string" ? data.url : null,
              data: data.data,
              title: typeof data.title === "string" ? data.title : null,
            };
            setKeyResources((prev) => [...prev, kr]);
          }
        } catch { /* ignore */ }
      });

      /* ---- Extension: domain-specific events ---- */

      es.addEventListener("tool_start", (e: MessageEvent) => {
        try {
          const data: unknown = JSON.parse(e.data as string);
          cbRef.current.onExtraEvent?.("tool_start", data);
        } catch { /* ignore */ }
      });

      es.addEventListener("tool_end", (e: MessageEvent) => {
        try {
          const data: unknown = JSON.parse(e.data as string);
          cbRef.current.onExtraEvent?.("tool_end", data);
        } catch { /* ignore */ }
      });

      /* ---- done ---- */

      es.addEventListener("done", () => {
        es.close();
        eventSourceRef.current = null;
        taskIdRef.current = null;
        cbRef.current.onRefreshNeeded();

        // Reload full session to get final state
        const sid = sessionIdRef.current;
        if (sid) {
          void fetchJson<SessionDetail>(`/api/sessions/${sid}`)
            .then((detail) => {
              setMessages(detail.messages);
              setKeyResources(detail.keyResources ?? []);
              cbRef.current.onSessionDetail?.(detail);
            })
            .catch(() => { /* best effort */ });
        }

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
        if (e instanceof MessageEvent && e.data) {
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
          setStatus("error");
          cbRef.current.onStreamEnd?.();
        }
        // Connection errors: EventSource auto-reconnects via Last-Event-ID.
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
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    taskIdRef.current = null;
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

    connectToTask,
    stopStreaming,
  };
}
