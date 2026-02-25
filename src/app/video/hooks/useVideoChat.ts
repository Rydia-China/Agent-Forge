"use client";

/**
 * Video-specific chat hook.
 *
 * Mirrors the core useChat hook but submits tasks to /api/video/tasks
 * with video_context, preload_mcps, and skills fields.
 * SSE subscription uses the shared /api/tasks/{taskId}/events endpoint.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentStatus } from "@/app/components/StatusBadge";
import {
  fetchJson,
  getErrorMessage,
  isRecord,
} from "@/app/components/client-utils";
import type {
  ChatMessage,
  KeyResourceItem,
  SessionDetail,
  UploadRequestPayload,
} from "@/app/types";
import type { VideoContext } from "../types";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface ActiveToolInfo {
  name: string;
  index: number;
  total: number;
}

export interface UseVideoChatReturn {
  sessionId: string | undefined;
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
  activeTool: ActiveToolInfo | null;
  status: AgentStatus;
  keyResources: KeyResourceItem[];
  updateKeyResource: (id: string, data: unknown, title?: string) => Promise<void>;
  deleteKeyResource: (id: string) => Promise<void>;
  sendMessage: (images?: string[]) => Promise<void>;
  /** Send a specific message directly, bypassing input state. */
  sendDirect: (text: string) => Promise<void>;
  stopStreaming: () => void;
  uploadDialog: UploadRequestPayload | null;
  setUploadDialog: (req: UploadRequestPayload | null) => void;
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export function useVideoChat(
  initialSessionId: string | undefined,
  userName: string,
  videoContext: VideoContext | null,
  /** MCP names to pre-load. */
  preloadMcps: string[],
  /** Skill names to inject. */
  skills: string[],
  onSessionCreated: (sessionId: string) => void,
  onRefreshNeeded: () => void,
  /** If set, auto-send this message on first mount. */
  autoMessage?: string,
): UseVideoChatReturn {
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
  const [uploadDialog, setUploadDialog] = useState<UploadRequestPayload | null>(null);
  const [activeTool, setActiveTool] = useState<ActiveToolInfo | null>(null);
  const [keyResources, setKeyResources] = useState<KeyResourceItem[]>([]);

  const taskIdRef = useRef<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const sessionIdRef = useRef<string | undefined>(initialSessionId);
  const activeSendRef = useRef(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Callback refs
  const onSessionCreatedRef = useRef(onSessionCreated);
  onSessionCreatedRef.current = onSessionCreated;
  const onRefreshNeededRef = useRef(onRefreshNeeded);
  onRefreshNeededRef.current = onRefreshNeeded;

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  // done → idle after 3s
  useEffect(() => {
    if (status !== "done") return;
    const t = setTimeout(() => setStatus("idle"), 3000);
    return () => clearTimeout(t);
  }, [status]);

  /* ---------------------------------------------------------------- */
  /*  SSE subscription (shared /api/tasks/{id}/events)                 */
  /* ---------------------------------------------------------------- */

  const connectToTask = useCallback(
    (taskId: string, opts?: { isReconnect?: boolean }) => {
      eventSourceRef.current?.close();

      setIsStreaming(true);
      setIsSending(true);
      activeSendRef.current = true;
      setStatus("running");

      if (!opts?.isReconnect) {
        setStreamingReply("");
        setStreamingTools([]);
      }

      taskIdRef.current = taskId;
      const es = new EventSource(`/api/tasks/${taskId}/events`);
      eventSourceRef.current = es;

      es.addEventListener("session", (e: MessageEvent) => {
        try {
          const data: unknown = JSON.parse(e.data as string);
          if (isRecord(data) && typeof data.session_id === "string") {
            setSessionId(data.session_id);
            sessionIdRef.current = data.session_id;
            onSessionCreatedRef.current(data.session_id);
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

      es.addEventListener("tool_start", (e: MessageEvent) => {
        try {
          const data: unknown = JSON.parse(e.data as string);
          if (isRecord(data) && typeof data.name === "string") {
            setActiveTool({
              name: data.name,
              index: typeof data.index === "number" ? data.index : 0,
              total: typeof data.total === "number" ? data.total : 1,
            });
          }
        } catch { /* ignore */ }
      });

      es.addEventListener("tool_end", (e: MessageEvent) => {
        console.log("[SSE] tool_end received", e.data);
        setActiveTool(null);
        // Debounced data refresh on every tool completion
        if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = setTimeout(() => {
          console.log("[SSE] tool_end debounce fired → onRefreshNeeded");
          onRefreshNeededRef.current();
        }, 600);
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

      es.addEventListener("upload_request", (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data as string) as UploadRequestPayload;
          if (data.uploadId && data.endpoint) {
            setUploadDialog(data);
            setStatus("needs_attention");
          }
        } catch { /* ignore */ }
      });

      es.addEventListener("done", () => {
        console.log("[SSE] done received → calling onRefreshNeeded");
        es.close();
        eventSourceRef.current = null;
        taskIdRef.current = null;
        onRefreshNeededRef.current();

        const sid = sessionIdRef.current;
        if (sid) {
          void fetchJson<SessionDetail>(`/api/sessions/${sid}`)
            .then((detail) => {
              setMessages(detail.messages);
              setKeyResources(detail.keyResources ?? []);
            })
            .catch(() => { /* best effort */ });
        }

        setIsStreaming(false);
        setIsSending(false);
        activeSendRef.current = false;
        setStreamingReply(null);
        setStreamingTools([]);
        setActiveTool(null);
        setStatus("done");
      });

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
          setActiveTool(null);
          setStatus("error");
        }
      });
    },
    [],
  );

  /* ---------------------------------------------------------------- */
  /*  Load initial session + auto-send                                 */
  /* ---------------------------------------------------------------- */

  const autoFiredRef = useRef(false);

  useEffect(() => {
    if (!initialSessionId) {
      // New session — check for auto-message
      if (autoMessage && videoContext && !autoFiredRef.current) {
        autoFiredRef.current = true;
        void submitText(autoMessage);
      } else if (!activeSendRef.current) {
        setSessionId(undefined);
        setMessages([]);
      }
      return;
    }
    if (activeSendRef.current) return;
    setIsLoadingSession(true);
    fetchJson<SessionDetail>(`/api/sessions/${initialSessionId}`)
      .then((data) => {
        setSessionId(data.id);
        setMessages(data.messages);
        setKeyResources(data.keyResources ?? []);
        if (
          data.activeTask &&
          (data.activeTask.status === "pending" || data.activeTask.status === "running")
        ) {
          connectToTask(data.activeTask.id, { isReconnect: true });
        }
      })
      .catch((err: unknown) => {
        setError(getErrorMessage(err, "Failed to load session."));
      })
      .finally(() => setIsLoadingSession(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSessionId, connectToTask]);

  /* ---------------------------------------------------------------- */
  /*  sendMessage — POST to /api/video/tasks                           */
  /* ---------------------------------------------------------------- */

  const generateTitleForSession = useCallback(async (sid: string, seed: string) => {
    try {
      await fetchJson(`/api/sessions/${sid}/title`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: seed }),
      });
    } catch { /* best effort */ }
  }, []);

  const submitText = useCallback(async (text: string, images?: string[]) => {
    if ((!text && !images?.length) || isSending || !videoContext) return;

    setError(null);
    setIsSending(true);
    activeSendRef.current = true;
    setInput("");

    const sid = sessionIdRef.current;
    const wasNewSession = !sid;
    const userMsg: ChatMessage = { role: "user", content: text || null };
    if (images?.length) userMsg.images = images;
    setMessages((prev) => [...prev, userMsg]);

    try {
      const payload: Record<string, unknown> = {
        message: text || "(image)",
        user: userName,
        video_context: videoContext,
        preload_mcps: preloadMcps,
        skills,
      };
      if (sid) payload.session_id = sid;
      if (images?.length) payload.images = images;

      const result = await fetchJson<{ task_id: string; session_id: string }>(
        "/api/video/tasks",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );

      if (!sid) {
        setSessionId(result.session_id);
        sessionIdRef.current = result.session_id;
        onSessionCreatedRef.current(result.session_id);
      }

      connectToTask(result.task_id);

      if (wasNewSession) {
        void generateTitleForSession(result.session_id, text || "Image upload");
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to submit video task."));
      setStatus("error");
      setIsSending(false);
      activeSendRef.current = false;
    }
  }, [isSending, userName, videoContext, preloadMcps, skills, connectToTask, generateTitleForSession]);

  const sendMessage = useCallback(async (images?: string[]) => {
    const text = input.trim();
    if (!text && !images?.length) return;
    await submitText(text, images);
  }, [input, submitText]);

  const sendDirect = useCallback(async (text: string) => {
    await submitText(text.trim());
  }, [submitText]);

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
    setActiveTool(null);

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
  /*  Key resource CRUD                                                */
  /* ---------------------------------------------------------------- */

  const handleUpdateKeyResource = useCallback(async (id: string, data: unknown, title?: string) => {
    const body: Record<string, unknown> = { data };
    if (title !== undefined) body.title = title;
    await fetchJson(`/api/key-resources/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setKeyResources((prev) =>
      prev.map((kr) => (kr.id === id ? { ...kr, data, ...(title !== undefined ? { title } : {}) } : kr)),
    );
  }, []);

  const handleDeleteKeyResource = useCallback(async (id: string) => {
    await fetchJson(`/api/key-resources/${id}`, { method: "DELETE" });
    setKeyResources((prev) => prev.filter((kr) => kr.id !== id));
  }, []);

  /* ---------------------------------------------------------------- */
  /*  Cleanup                                                          */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, []);

  return {
    sessionId,
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
    activeTool,
    status,
    keyResources,
    updateKeyResource: handleUpdateKeyResource,
    deleteKeyResource: handleDeleteKeyResource,
    sendMessage,
    sendDirect,
    stopStreaming,
    uploadDialog,
    setUploadDialog,
  };
}
