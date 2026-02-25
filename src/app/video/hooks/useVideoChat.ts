"use client";

/**
 * Video-specific chat hook.
 *
 * Composes useTaskStream for SSE infrastructure, adds video-domain features:
 * - POST to /api/video/tasks with video_context, preload_mcps, skills
 * - activeTool tracking (tool_start / tool_end events)
 * - sendDirect (bypass input state)
 * - autoMessage (auto-send on first mount)
 * - key resource CRUD
 * - debounced refresh on tool completion
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
  UploadRequestPayload,
} from "@/app/types";
import { useTaskStream } from "@/app/components/hooks/useTaskStream";
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
  preloadMcps: string[],
  skills: string[],
  onSessionCreated: (sessionId: string) => void,
  onRefreshNeeded: () => void,
  autoMessage?: string,
): UseVideoChatReturn {
  const [activeTool, setActiveTool] = useState<ActiveToolInfo | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onRefreshNeededRef = useRef(onRefreshNeeded);
  onRefreshNeededRef.current = onRefreshNeeded;

  /* ---- Shared SSE infrastructure ---- */
  const stream = useTaskStream(initialSessionId, {
    onSessionCreated,
    onRefreshNeeded,
    onExtraEvent: (type, data) => {
      if (type === "tool_start" && isRecord(data) && typeof data.name === "string") {
        setActiveTool({
          name: data.name,
          index: typeof data.index === "number" ? data.index : 0,
          total: typeof data.total === "number" ? data.total : 1,
        });
      } else if (type === "tool_end") {
        setActiveTool(null);
        // Debounced data refresh on every tool completion
        if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = setTimeout(() => {
          onRefreshNeededRef.current();
        }, 600);
      }
    },
    onStreamEnd: () => {
      setActiveTool(null);
    },
  });

  /* ---- Auto-send on mount ---- */
  const autoFiredRef = useRef(false);

  useEffect(() => {
    if (!initialSessionId && autoMessage && videoContext && !autoFiredRef.current) {
      autoFiredRef.current = true;
      void submitText(autoMessage);
    } else if (!initialSessionId && !stream.activeSendRef.current) {
      stream.setSessionId(undefined);
      stream.setMessages([]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSessionId]);

  /* ---- sendMessage — POST to /api/video/tasks ---- */

  const generateTitle = useCallback(async (sid: string, seed: string) => {
    try {
      await fetchJson(`/api/sessions/${sid}/title`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: seed }),
      });
    } catch { /* best effort */ }
  }, []);

  const submitText = useCallback(async (text: string, images?: string[]) => {
    if ((!text && !images?.length) || stream.isSending || !videoContext) return;

    stream.setError(null);
    stream.setIsSending(true);
    stream.activeSendRef.current = true;
    stream.setInput("");

    const sid = stream.sessionIdRef.current;
    const wasNewSession = !sid;
    const userMsg: ChatMessage = { role: "user", content: text || null };
    if (images?.length) userMsg.images = images;
    stream.setMessages((prev) => [...prev, userMsg]);

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
        stream.setSessionId(result.session_id);
        stream.sessionIdRef.current = result.session_id;
      }

      stream.connectToTask(result.task_id);

      if (wasNewSession) {
        void generateTitle(result.session_id, text || "Image upload");
      }
    } catch (err: unknown) {
      stream.setError(getErrorMessage(err, "Failed to submit video task."));
      stream.setStatus("error");
      stream.setIsSending(false);
      stream.activeSendRef.current = false;
    }
  }, [stream, userName, videoContext, preloadMcps, skills, generateTitle]);

  const sendMessage = useCallback(async (images?: string[]) => {
    const text = stream.input.trim();
    if (!text && !images?.length) return;
    await submitText(text, images);
  }, [stream.input, submitText]);

  const sendDirect = useCallback(async (text: string) => {
    await submitText(text.trim());
  }, [submitText]);

  /* ---- stopStreaming (extends base with activeTool cleanup) ---- */

  const stopStreaming = useCallback(() => {
    stream.stopStreaming();
    setActiveTool(null);
  }, [stream]);

  /* ---- Key resource CRUD ---- */

  const handleUpdateKeyResource = useCallback(async (id: string, data: unknown, title?: string) => {
    const body: Record<string, unknown> = { data };
    if (title !== undefined) body.title = title;
    await fetchJson(`/api/key-resources/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    stream.setKeyResources((prev) =>
      prev.map((kr) => (kr.id === id ? { ...kr, data, ...(title !== undefined ? { title } : {}) } : kr)),
    );
  }, [stream]);

  const handleDeleteKeyResource = useCallback(async (id: string) => {
    await fetchJson(`/api/key-resources/${id}`, { method: "DELETE" });
    stream.setKeyResources((prev) => prev.filter((kr) => kr.id !== id));
  }, [stream]);

  /* ---- Cleanup ---- */

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, []);

  /* ---- Return ---- */

  return {
    sessionId: stream.sessionId,
    messages: stream.messages,
    input: stream.input,
    setInput: stream.setInput,
    error: stream.error,
    setError: stream.setError,
    isSending: stream.isSending,
    isStreaming: stream.isStreaming,
    isLoadingSession: stream.isLoadingSession,
    streamingReply: stream.streamingReply,
    streamingTools: stream.streamingTools,
    activeTool,
    status: stream.status,
    keyResources: stream.keyResources,
    updateKeyResource: handleUpdateKeyResource,
    deleteKeyResource: handleDeleteKeyResource,
    sendMessage,
    sendDirect,
    stopStreaming,
    uploadDialog: stream.uploadDialog,
    setUploadDialog: stream.setUploadDialog,
  };
}
