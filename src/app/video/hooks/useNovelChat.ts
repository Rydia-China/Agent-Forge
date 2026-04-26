"use client";

/**
 * Novel-level chat hook.
 *
 * Uses the current SubAgent SSE infrastructure and submits to the /video
 * novel-specific route with a NovelContextProvider on the server.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentStatus } from "@/app/components/StatusBadge";
import {
  fetchJson,
  getErrorMessage,
  isRecord,
} from "@/app/components/client-utils";
import type { ChatMessage } from "@/app/types";
import { useSubAgentStream } from "@/app/components/hooks/useSubAgentStream";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface ActiveToolInfo {
  name: string;
  index: number;
  total: number;
}

export interface UseNovelChatReturn {
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
  sendMessage: (images?: string[]) => Promise<void>;
  sendDirect: (text: string) => Promise<void>;
  stopStreaming: () => void;
}

interface SubmitNovelChatResponse {
  subagent_id?: string;
  task_id?: string;
  session_id: string;
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export function useNovelChat(
  initialSessionId: string | undefined,
  novelId: string,
  skills: string[],
  onSessionCreated: (sessionId: string) => void,
  onRefreshNeeded: () => void,
  model?: string,
): UseNovelChatReturn {
  const [activeTool, setActiveTool] = useState<ActiveToolInfo | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onRefreshNeededRef = useRef(onRefreshNeeded);
  onRefreshNeededRef.current = onRefreshNeeded;

  const stream = useSubAgentStream(initialSessionId, {
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

  useEffect(() => {
    if (!initialSessionId && !stream.activeSendRef.current) {
      stream.setSessionId(undefined);
      stream.setMessages([]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSessionId]);

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
    if ((!text && !images?.length) || stream.isSending) return;

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
      const payload: {
        message: string;
        user: string;
        skills: string[];
        session_id?: string;
        images?: string[];
        model?: string;
      } = {
        message: text || "(image)",
        user: `video:${novelId}`,
        skills,
      };
      if (sid) payload.session_id = sid;
      if (images?.length) payload.images = images;
      if (model) payload.model = model;

      const result = await fetchJson<SubmitNovelChatResponse>(
        `/api/video/novel/${encodeURIComponent(novelId)}/chat`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const subagentId = result.subagent_id ?? result.task_id;
      if (!subagentId) throw new Error("Missing subagent id from novel chat response.");

      if (!sid) {
        stream.setSessionId(result.session_id);
        stream.sessionIdRef.current = result.session_id;
      }

      stream.connectToSubAgent(subagentId);

      if (wasNewSession) {
        void generateTitle(result.session_id, text || "Image upload");
      }
    } catch (err: unknown) {
      stream.setError(getErrorMessage(err, "Failed to submit novel chat task."));
      stream.setStatus("error");
      stream.setIsSending(false);
      stream.activeSendRef.current = false;
    }
  }, [stream, novelId, skills, generateTitle, model]);

  const sendMessage = useCallback(async (images?: string[]) => {
    const text = stream.input.trim();
    if (!text && !images?.length) return;
    await submitText(text, images);
  }, [stream.input, submitText]);

  const sendDirect = useCallback(async (text: string) => {
    await submitText(text.trim());
  }, [submitText]);

  const stopStreaming = useCallback(() => {
    stream.stopStreaming();
    setActiveTool(null);
  }, [stream]);

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, []);

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
    sendMessage,
    sendDirect,
    stopStreaming,
  };
}
