"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentStatus } from "../StatusBadge";
import { fetchJson, getErrorMessage } from "../client-utils";
import type {
  ChatMessage,
  KeyResourceItem,
  SessionDetail,
  UploadRequestPayload,
} from "../../types";
import { useTaskStream } from "./useTaskStream";

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
  const [title, setTitle] = useState<string | null>(null);

  // Callback refs
  const onStatusChangeRef = useRef(onStatusChange);
  onStatusChangeRef.current = onStatusChange;
  const onTitleChangeRef = useRef(onTitleChange);
  onTitleChangeRef.current = onTitleChange;

  /* ---- Shared SSE infrastructure ---- */
  const stream = useTaskStream(initialSessionId, {
    onSessionCreated,
    onRefreshNeeded,
    onSessionDetail: (detail: SessionDetail) => {
      if (detail.title) {
        setTitle(detail.title);
        onTitleChangeRef.current(detail.title);
      }
    },
  });

  // Forward status changes
  useEffect(() => {
    onStatusChangeRef.current(stream.status);
  }, [stream.status]);

  /* ---- reloadSession ---- */

  const reloadSession = useCallback(async () => {
    const sid = stream.sessionIdRef.current;
    if (!sid) return;
    try {
      const data = await fetchJson<SessionDetail>(`/api/sessions/${sid}`);
      stream.setMessages(data.messages);
      stream.setKeyResources(data.keyResources ?? []);
    } catch {
      /* best effort */
    }
  }, [stream]);

  /* ---- generateTitle ---- */

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

  /* ---- sendMessage ---- */

  const sendMessage = useCallback(async (images?: string[]) => {
    const text = stream.input.trim();
    const hasImages = images && images.length > 0;
    if ((!text && !hasImages) || stream.isSending) return;
    stream.setError(null);
    stream.setIsSending(true);
    stream.activeSendRef.current = true;
    stream.setInput("");
    const wasNewSession = !stream.sessionIdRef.current;
    const sid = stream.sessionIdRef.current;

    const userMsg: ChatMessage = { role: "user", content: text || null };
    if (hasImages) userMsg.images = images;
    stream.setMessages((prev) => [...prev, userMsg]);

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

      if (!sid) {
        stream.setSessionId(result.session_id);
        stream.sessionIdRef.current = result.session_id;
      }

      stream.connectToTask(result.task_id);

      if (wasNewSession) {
        void generateTitle(result.session_id, text);
      }
    } catch (err: unknown) {
      stream.setError(getErrorMessage(err, "Failed to submit task."));
      stream.setStatus("error");
      stream.setIsSending(false);
      stream.activeSendRef.current = false;
    }
  }, [stream, userName, generateTitle]);

  /* ---- Return ---- */

  return {
    sessionId: stream.sessionId,
    title,
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
    status: stream.status,
    setStatus: stream.setStatus,
    keyResources: stream.keyResources,
    sendMessage,
    stopStreaming: stream.stopStreaming,
    reloadSession,
    sessionIdRef: stream.sessionIdRef,
    uploadDialog: stream.uploadDialog,
    setUploadDialog: stream.setUploadDialog,
  };
}
