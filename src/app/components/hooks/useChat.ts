"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentStatus } from "../StatusBadge";
import { fetchJson, getErrorMessage, isRecord } from "../client-utils";
import type {
  ChatMessage,
  KeyResourceItem,
  SessionDetail,
  UploadRequestPayload,
} from "../../types";

export interface UseChatReturn {
  sessionId: string | undefined;
  title: string | null;
  messages: ChatMessage[];
  input: string;
  setInput: (v: string) => void;
  error: string | null;
  setError: (v: string | null) => void;
  isSending: boolean;
  isStreaming: boolean;
  isLoadingSession: boolean;
  streamingReply: string | null;
  streamingTools: string[];
  status: AgentStatus;
  setStatus: (s: AgentStatus) => void;
  keyResources: KeyResourceItem[];
  sendMessage: (images?: string[]) => Promise<void>;
  stopStreaming: () => void;
  reloadSession: () => Promise<void>;
  sessionIdRef: React.RefObject<string | undefined>;
  setUploadDialog: (req: UploadRequestPayload | null) => void;
  uploadDialog: UploadRequestPayload | null;
}

export function useChat(
  initialSessionId: string | undefined,
  userName: string,
  onSessionCreated: (sessionId: string) => void,
  onTitleChange: (title: string) => void,
  onRefreshNeeded: () => void,
  onStatusChange: (status: AgentStatus) => void,
): UseChatReturn {
  const [sessionId, setSessionId] = useState<string | undefined>(initialSessionId);
  const [title, setTitle] = useState<string | null>(null);
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

  /** Current active task ID (for cancel / reconnect). */
  const taskIdRef = useRef<string | null>(null);
  /** EventSource instance for the current task. */
  const eventSourceRef = useRef<EventSource | null>(null);
  const sessionIdRef = useRef<string | undefined>(initialSessionId);
  const activeSendRef = useRef(false);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  // Callback refs — keep identity-stable to avoid cascading re-renders
  const onStatusChangeRef = useRef(onStatusChange);
  onStatusChangeRef.current = onStatusChange;
  const onTitleChangeRef = useRef(onTitleChange);
  onTitleChangeRef.current = onTitleChange;
  const onSessionCreatedRef = useRef(onSessionCreated);
  onSessionCreatedRef.current = onSessionCreated;
  const onRefreshNeededRef = useRef(onRefreshNeeded);
  onRefreshNeededRef.current = onRefreshNeeded;

  useEffect(() => {
    onStatusChangeRef.current(status);
  }, [status]);

  // Done → idle after 3s
  useEffect(() => {
    if (status !== "done") return;
    const timer = setTimeout(() => setStatus("idle"), 3000);
    return () => clearTimeout(timer);
  }, [status]);

  /* ---------------------------------------------------------------- */
  /*  EventSource SSE subscription                                     */
  /* ---------------------------------------------------------------- */

  /** Connect to a task's SSE event stream. Handles all event types. */
  const connectToTask = useCallback(
    (taskId: string, opts?: { isReconnect?: boolean }) => {
      // Clean up any existing EventSource
      eventSourceRef.current?.close();

      const isReconnect = opts?.isReconnect ?? false;
      if (!isReconnect) {
        setStreamingReply("");
        setStreamingTools([]);
        setIsStreaming(true);
        setStatus("running");
      }

      taskIdRef.current = taskId;

      const es = new EventSource(`/api/tasks/${taskId}/events`);
      eventSourceRef.current = es;

      es.addEventListener("session", (e: MessageEvent) => {
        try {
          const data: unknown = JSON.parse(e.data as string);
          if (isRecord(data)) {
            const s = data.session_id;
            if (typeof s === "string") {
              setSessionId(s);
              sessionIdRef.current = s;
              onSessionCreatedRef.current(s);
            }
          }
        } catch { /* ignore */ }
      });

      es.addEventListener("delta", (e: MessageEvent) => {
        try {
          const data: unknown = JSON.parse(e.data as string);
          if (isRecord(data)) {
            const delta = data.text;
            if (typeof delta === "string") {
              setStreamingReply((prev) => (prev ?? "") + delta);
            }
          }
        } catch { /* ignore */ }
      });

      es.addEventListener("tool", (e: MessageEvent) => {
        try {
          const data: unknown = JSON.parse(e.data as string);
          if (isRecord(data)) {
            const summary = data.summary;
            if (typeof summary === "string") {
              setStreamingTools((prev) =>
                prev.includes(summary) ? prev : [...prev, summary],
              );
            }
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

      es.addEventListener("done", (e: MessageEvent) => {
        es.close();
        eventSourceRef.current = null;
        taskIdRef.current = null;
        onRefreshNeededRef.current();

        // Reload the full session to get final state
        const sid = sessionIdRef.current;
        if (sid) {
          void fetchJson<SessionDetail>(`/api/sessions/${sid}`)
            .then((detail) => {
              setMessages(detail.messages);
              setKeyResources(detail.keyResources ?? []);
              if (detail.title) {
                setTitle(detail.title);
                onTitleChangeRef.current(detail.title);
              }
            })
            .catch(() => { /* best effort */ });
        }

        setIsStreaming(false);
        setIsSending(false);
        activeSendRef.current = false;
        setStreamingReply(null);
        setStreamingTools([]);
        setStatus("done");
      });

      es.addEventListener("error", (e: Event) => {
        // SSE "error" can be:
        //  1. A server-sent error event (MessageEvent with data)
        //  2. A connection error (plain Event)
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
        }
        // For connection errors, EventSource auto-reconnects with Last-Event-ID.
        // No action needed — the browser handles it.
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
        setTitle(data.title);
        setMessages(data.messages);
        setKeyResources(data.keyResources ?? []);
        if (data.title) onTitleChangeRef.current(data.title);

        // Reconnect to active task if one exists
        if (
          data.activeTask &&
          (data.activeTask.status === "pending" ||
            data.activeTask.status === "running")
        ) {
          connectToTask(data.activeTask.id, { isReconnect: true });
        }
      })
      .catch((err: unknown) => {
        setError(getErrorMessage(err, "Failed to load session."));
      })
      .finally(() => setIsLoadingSession(false));
  }, [initialSessionId, connectToTask]);

  /* ---------------------------------------------------------------- */
  /*  reloadSession                                                    */
  /* ---------------------------------------------------------------- */

  const reloadSession = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      const data = await fetchJson<SessionDetail>(`/api/sessions/${sid}`);
      setMessages(data.messages);
      setKeyResources(data.keyResources ?? []);
    } catch {
      /* best effort */
    }
  }, []);

  /* ---------------------------------------------------------------- */
  /*  generateTitle                                                    */
  /* ---------------------------------------------------------------- */

  const generateTitle = useCallback(async (sid: string, seed: string) => {
    try {
      const result = await fetchJson<{ id: string; title: string }>(
        `/api/sessions/${sid}/title`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: seed }),
        },
      );
      setTitle(result.title);
      onTitleChangeRef.current(result.title);
    } catch {
      /* best effort */
    }
  }, []);

  /* ---------------------------------------------------------------- */
  /*  stopStreaming  (cancel task)                                      */
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
  }, []);

  /* ---------------------------------------------------------------- */
  /*  sendMessage  (submit task)                                       */
  /* ---------------------------------------------------------------- */

  const sendMessage = useCallback(async (images?: string[]) => {
    const text = input.trim();
    const hasImages = images && images.length > 0;
    if ((!text && !hasImages) || isSending) return;
    setError(null);
    setIsSending(true);
    activeSendRef.current = true;
    setInput("");
    const wasNewSession = !sessionIdRef.current;
    const sid = sessionIdRef.current;

    const userMsg: ChatMessage = { role: "user", content: text || null };
    if (hasImages) userMsg.images = images;
    setMessages((prev) => [...prev, userMsg]);

    try {
      const payload: Record<string, unknown> = { message: text || "(image)", user: userName };
      if (sid) payload.session_id = sid;
      if (hasImages) payload.images = images;

      const result = await fetchJson<{ task_id: string; session_id: string }>(
        "/api/tasks",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );

      // Update session if newly created
      if (!sid) {
        setSessionId(result.session_id);
        sessionIdRef.current = result.session_id;
        onSessionCreatedRef.current(result.session_id);
      }

      // Connect to SSE events
      connectToTask(result.task_id);

      // Generate title for new sessions
      if (wasNewSession) {
        void generateTitle(result.session_id, text);
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to submit task."));
      setStatus("error");
      setIsSending(false);
      activeSendRef.current = false;
    }
  }, [input, isSending, userName, connectToTask, generateTitle]);

  /* ---------------------------------------------------------------- */
  /*  Cleanup on unmount                                               */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
    };
  }, []);

  return {
    sessionId,
    title,
    messages,
    input,
    setInput,
    error,
    setError,
    isSending,
    isStreaming,
    isLoadingSession,
    streamingReply,
    streamingTools,
    status,
    setStatus,
    keyResources,
    sendMessage,
    stopStreaming,
    reloadSession,
    sessionIdRef,
    uploadDialog,
    setUploadDialog,
  };
}
