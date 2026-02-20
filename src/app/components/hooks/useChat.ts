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
  sendMessage: () => Promise<void>;
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

  const abortRef = useRef<AbortController | null>(null);
  const sessionIdRef = useRef<string | undefined>(initialSessionId);
  const activeSendRef = useRef(false);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  // Status change callback
  const onStatusChangeRef = useRef(onStatusChange);
  useEffect(() => {
    onStatusChangeRef.current = onStatusChange;
  }, [onStatusChange]);
  useEffect(() => {
    onStatusChangeRef.current(status);
  }, [status]);

  // Title change callback
  const onTitleChangeRef = useRef(onTitleChange);
  useEffect(() => {
    onTitleChangeRef.current = onTitleChange;
  }, [onTitleChange]);

  // Done → idle after 3s
  useEffect(() => {
    if (status !== "done") return;
    const timer = setTimeout(() => setStatus("idle"), 3000);
    return () => clearTimeout(timer);
  }, [status]);

  // Load initial session
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
      })
      .catch((err: unknown) => {
        setError(getErrorMessage(err, "Failed to load session."));
      })
      .finally(() => setIsLoadingSession(false));
  }, [initialSessionId]);

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

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || isSending) return;
    setError(null);
    setIsSending(true);
    setIsStreaming(true);
    activeSendRef.current = true;
    setStatus("running");
    setInput("");
    const wasNewSession = !sessionIdRef.current;
    const sid = sessionIdRef.current;
    let streamSessionId: string | null = sid ?? null;
    let doneSessionId: string | null = null;
    let streamError: string | null = null;

    const userMsg: ChatMessage = { role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setStreamingReply("");
    setStreamingTools([]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const payload: Record<string, unknown> = { message: text, user: userName };
      if (sid) payload.session_id = sid;

      const res = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) throw new Error(`Stream failed (${res.status})`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const handleEvent = (raw: string) => {
        const lines = raw.split(/\r?\n/);
        let event = "message";
        const dataLines: string[] = [];
        for (const line of lines) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
        }
        if (dataLines.length === 0) return;
        let payloadData: unknown;
        try {
          payloadData = JSON.parse(dataLines.join("\n"));
        } catch {
          return;
        }
        if (!isRecord(payloadData)) return;

        if (event === "session") {
          const s = payloadData.session_id;
          if (typeof s === "string") {
            streamSessionId = s;
            setSessionId(s);
            sessionIdRef.current = s;
            onSessionCreated(s);
          }
        } else if (event === "delta") {
          const delta = payloadData.text;
          if (typeof delta === "string") setStreamingReply((prev) => (prev ?? "") + delta);
        } else if (event === "tool") {
          const summary = payloadData.summary;
          if (typeof summary === "string")
            setStreamingTools((prev) => (prev.includes(summary) ? prev : [...prev, summary]));
        } else if (event === "done") {
          const s = payloadData.session_id;
          if (typeof s === "string") doneSessionId = s;
          onRefreshNeeded();
        } else if (event === "upload_request") {
          const req = payloadData as UploadRequestPayload;
          if (req.uploadId && req.endpoint) {
            setUploadDialog(req);
            setStatus("needs_attention");
          }
        } else if (event === "key_resource") {
          const kr: KeyResourceItem = {
            id: typeof payloadData.id === "string" ? payloadData.id : crypto.randomUUID(),
            mediaType: typeof payloadData.mediaType === "string" ? payloadData.mediaType : "json",
            url: typeof payloadData.url === "string" ? payloadData.url : null,
            data: payloadData.data,
            title: typeof payloadData.title === "string" ? payloadData.title : null,
          };
          setKeyResources((prev) => [...prev, kr]);
        } else if (event === "error") {
          const errMsg = payloadData.error;
          if (typeof errMsg === "string") streamError = errMsg;
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary = buffer.indexOf("\n\n");
        while (boundary !== -1) {
          handleEvent(buffer.slice(0, boundary));
          buffer = buffer.slice(boundary + 2);
          boundary = buffer.indexOf("\n\n");
        }
      }

      if (streamError) {
        setError(streamError);
        setStatus("error");
        return;
      }

      const finalSessionId = doneSessionId ?? streamSessionId;
      if (finalSessionId) {
        try {
          const data = await fetchJson<SessionDetail>(`/api/sessions/${finalSessionId}`);
          setMessages(data.messages);
          setKeyResources(data.keyResources ?? []);
          if (data.title) {
            setTitle(data.title);
            onTitleChange(data.title);
          }
        } catch {
          /* best effort */
        }
        if (wasNewSession) void generateTitle(finalSessionId, text);
      }
      setStatus("done");
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") {
        const s = streamSessionId;
        if (s) {
          try {
            const data = await fetchJson<SessionDetail>(`/api/sessions/${s}`);
            setMessages(data.messages);
            setKeyResources(data.keyResources ?? []);
          } catch {
            /* best effort */
          }
        }
        setStatus("idle");
      } else {
        setError(getErrorMessage(err, "Failed to stream message."));
        setStatus("error");
      }
    } finally {
      abortRef.current = null;
      activeSendRef.current = false;
      setIsSending(false);
      setIsStreaming(false);
      setStreamingReply(null);
      setStreamingTools([]);
    }
  }, [input, isSending, userName, onSessionCreated, onRefreshNeeded, onTitleChange, generateTitle]);

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
