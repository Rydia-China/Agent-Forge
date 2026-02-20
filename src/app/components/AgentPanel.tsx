"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentStatus } from "./StatusBadge";
import { fetchJson, getErrorMessage, isRecord, parseJsonObject } from "./client-utils";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  images?: string[];
  tool_calls?: ToolCall[];
  tool_call_id?: string;
};

type SessionDetail = {
  id: string;
  title: string | null;
  messages: ChatMessage[];
};

type UploadRequestPayload = {
  uploadId: string;
  endpoint: string;
  method: "PUT" | "POST";
  headers?: Record<string, string>;
  fields?: Record<string, string>;
  fileFieldName: string;
  accept?: string;
  purpose?: string;
  maxSizeMB?: number;
  bodyTemplate?: Record<string, string>;
  timeout?: number;
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function summarizeToolCalls(calls: ToolCall[]): string {
  const tools: string[] = [];
  const skills: string[] = [];
  for (const call of calls) {
    const name = call.function.name;
    if (name.startsWith("skills__")) {
      const parsed = parseJsonObject(call.function.arguments);
      const skillName = parsed && typeof parsed.name === "string" ? parsed.name : "skill";
      if (!skills.includes(skillName)) skills.push(skillName);
    } else {
      if (!tools.includes(name)) tools.push(name);
    }
  }
  const parts: string[] = [];
  if (tools.length > 0) parts.push(`调用了工具：${tools.join("、")}`);
  if (skills.length > 0) parts.push(`使用了 skill：${skills.join("、")}`);
  return parts.join(" · ");
}

function mergeStreamingSummaries(summaries: string[]): string {
  const tools: string[] = [];
  const skills: string[] = [];
  for (const s of summaries) {
    const toolMatch = s.match(/^调用了工具：(.+)$/);
    if (toolMatch) {
      const name = toolMatch[1];
      if (name && !tools.includes(name)) tools.push(name);
      continue;
    }
    const skillMatch = s.match(/^使用了 skill[：:](.+)$/);
    if (skillMatch) {
      const name = skillMatch[1];
      if (name && !skills.includes(name)) skills.push(name);
      continue;
    }
    if (s === "使用了 skill") {
      if (!skills.includes("skill")) skills.push("skill");
    }
  }
  const parts: string[] = [];
  if (tools.length > 0) parts.push(`调用了工具：${tools.join("、")}`);
  if (skills.length > 0) parts.push(`使用了 skill：${skills.join("、")}`);
  return parts.join(" · ");
}

const roleStyles: Record<
  ChatMessage["role"],
  { label: string; tone: string; chip: string }
> = {
  user: {
    label: "User",
    tone: "border-slate-700 bg-slate-900/60",
    chip: "bg-slate-700 text-slate-100",
  },
  assistant: {
    label: "Assistant",
    tone: "border-emerald-500/40 bg-emerald-500/10",
    chip: "bg-emerald-600 text-emerald-50",
  },
  system: {
    label: "System",
    tone: "border-amber-500/40 bg-amber-500/10",
    chip: "bg-amber-500 text-amber-950",
  },
  tool: {
    label: "Tool",
    tone: "border-sky-500/40 bg-sky-500/10",
    chip: "bg-sky-600 text-sky-50",
  },
};

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

export interface AgentPanelProps {
  /** Load an existing session. Omit for a new session. */
  initialSessionId?: string;
  userName: string;
  onStatusChange: (status: AgentStatus) => void;
  onSessionCreated: (sessionId: string) => void;
  onTitleChange: (title: string) => void;
  onClose: () => void;
  /** Called after agent done / resource-mutating tool calls. */
  onRefreshNeeded: () => void;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function AgentPanel({
  initialSessionId,
  userName,
  onStatusChange,
  onSessionCreated,
  onTitleChange,
  onClose,
  onRefreshNeeded,
}: AgentPanelProps) {
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
  const [isComposing, setIsComposing] = useState(false);
  const [pendingImages, setPendingImages] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadDialog, setUploadDialog] = useState<UploadRequestPayload | null>(null);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [status, setStatus] = useState<AgentStatus>("idle");

  const endRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const sessionIdRef = useRef<string | undefined>(initialSessionId);
  const activeSendRef = useRef(false);

  // Keep ref in sync
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  // Status change callback — use ref to avoid re-firing when parent re-renders
  const onStatusChangeRef = useRef(onStatusChange);
  useEffect(() => { onStatusChangeRef.current = onStatusChange; }, [onStatusChange]);
  useEffect(() => {
    onStatusChangeRef.current(status);
  }, [status]);

  // Auto-scroll
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingReply, streamingTools]);

  // Done → idle after 3s
  useEffect(() => {
    if (status !== "done") return;
    const timer = setTimeout(() => setStatus("idle"), 3000);
    return () => clearTimeout(timer);
  }, [status]);

  // Load initial session
  useEffect(() => {
    if (!initialSessionId) return;
    // Skip if session was just created during streaming — sendMessage handles messages
    if (activeSendRef.current) return;
    setIsLoadingSession(true);
    fetchJson<SessionDetail>(`/api/sessions/${initialSessionId}`)
      .then((data) => {
        setSessionId(data.id);
        setTitle(data.title);
        setMessages(data.messages);
        if (data.title) onTitleChange(data.title);
      })
      .catch((err: unknown) => {
        setError(getErrorMessage(err, "Failed to load session."));
      })
      .finally(() => setIsLoadingSession(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSessionId]);

  const uploadImage = useCallback(async (file: File): Promise<string | null> => {
    const form = new FormData();
    form.append("file", file);
    form.append("folder", "chat-images");
    try {
      const result = await fetchJson<{ url: string }>("/api/oss/upload", {
        method: "POST",
        body: form,
      });
      return result.url;
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to upload image."));
      return null;
    }
  }, []);

  const handleImageFiles = useCallback(
    async (files: File[]) => {
      const imageFiles = files.filter((f) => f.type.startsWith("image/"));
      if (imageFiles.length === 0) return;
      setIsUploading(true);
      try {
        const urls = await Promise.all(imageFiles.map(uploadImage));
        const valid = urls.filter((u): u is string => u !== null);
        if (valid.length > 0) setPendingImages((prev) => [...prev, ...valid]);
      } finally {
        setIsUploading(false);
      }
    },
    [uploadImage],
  );

  const generateTitle = useCallback(
    async (sid: string, seed: string) => {
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
        onTitleChange(result.title);
      } catch {
        /* best effort */
      }
    },
    [onTitleChange],
  );

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  /* ---- Send message (SSE) ---- */
  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || isSending) return;
    setError(null);
    setIsSending(true);
    setIsStreaming(true);
    activeSendRef.current = true;
    setStatus("running");
    setInput("");
    const imagesToSend = [...pendingImages];
    setPendingImages([]);
    const wasNewSession = !sessionIdRef.current;
    const sid = sessionIdRef.current;
    let streamSessionId: string | null = sid ?? null;
    let doneSessionId: string | null = null;
    let streamError: string | null = null;

    const userMsg: ChatMessage = { role: "user", content: text };
    if (imagesToSend.length > 0) userMsg.images = imagesToSend;
    setMessages((prev) => [...prev, userMsg]);
    setStreamingReply("");
    setStreamingTools([]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const payload: Record<string, unknown> = { message: text, user: userName };
      if (sid) payload.session_id = sid;
      if (imagesToSend.length > 0) payload.images = imagesToSend;

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
        // Reload persisted messages
        try {
          const data = await fetchJson<SessionDetail>(`/api/sessions/${finalSessionId}`);
          setMessages(data.messages);
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
  }, [input, isSending, pendingImages, userName, onSessionCreated, onRefreshNeeded, onTitleChange, generateTitle]);

  /* ---- Upload ---- */
  const executeUpload = useCallback(
    async (req: UploadRequestPayload, file: File) => {
      const sid = sessionIdRef.current;
      if (!sid) return;
      setUploadProgress("上传中…");
      setStatus("running");
      const timeoutMs = (req.timeout ?? 60) * 1000;
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), timeoutMs);
      try {
        let res: Response;
        if (req.bodyTemplate) {
          const fileText = await file.text();
          const nameNoExt = file.name.replace(/\.[^.]+$/, "");
          const now = new Date();
          const ts = `${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
          const rp = (s: string) =>
            s
              .replace(/\{\{fileContent\}\}/g, fileText)
              .replace(/\{\{fileName\}\}/g, nameNoExt)
              .replace(/\{\{fileNameFull\}\}/g, file.name)
              .replace(/\{\{timestamp\}\}/g, ts);
          const jsonBody: Record<string, string> = {};
          for (const [k, v] of Object.entries(req.bodyTemplate)) jsonBody[k] = rp(v);
          setUploadProgress(`上传中… (${(file.size / 1024 / 1024).toFixed(1)}MB)`);
          res = await fetch(req.endpoint, {
            method: req.method,
            headers: { "Content-Type": "application/json", ...req.headers },
            body: JSON.stringify(jsonBody),
            signal: ac.signal,
          });
        } else if (req.method === "PUT") {
          res = await fetch(req.endpoint, {
            method: "PUT",
            headers: { ...req.headers },
            body: file,
            signal: ac.signal,
          });
        } else {
          const form = new FormData();
          if (req.fields) for (const [k, v] of Object.entries(req.fields)) form.append(k, v);
          form.append(req.fileFieldName, file);
          res = await fetch(req.endpoint, {
            method: "POST",
            headers: { ...req.headers },
            body: form,
            signal: ac.signal,
          });
        }

        let url: string | undefined;
        try {
          const body: unknown = await res.json();
          if (isRecord(body) && typeof body.url === "string") url = body.url;
        } catch {
          /* non-JSON */
        }

        await fetchJson(`/api/sessions/${sid}/upload-result`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            uploadId: req.uploadId,
            success: res.ok,
            url,
            filename: file.name,
            size: file.size,
            error: res.ok ? undefined : `HTTP ${res.status}`,
          }),
        });
        setUploadProgress(null);
        setUploadDialog(null);
        // Reload session messages
        try {
          const data = await fetchJson<SessionDetail>(`/api/sessions/${sid}`);
          setMessages(data.messages);
        } catch {
          /* best effort */
        }
      } catch (err: unknown) {
        setUploadProgress(null);
        if (err instanceof DOMException && err.name === "AbortError") {
          setError(`上传超时 (${req.timeout ?? 60}s)`);
        } else {
          setError(getErrorMessage(err, "Upload failed."));
        }
      } finally {
        clearTimeout(timer);
      }
    },
    [],
  );

  const openManualUpload = useCallback(() => {
    setUploadDialog({
      uploadId: crypto.randomUUID(),
      endpoint: "",
      method: "POST",
      fileFieldName: "file",
      purpose: "手动上传文件",
    });
  }, []);

  const cancelUpload = useCallback(async (req: UploadRequestPayload) => {
    const sid = sessionIdRef.current;
    setUploadDialog(null);
    setUploadProgress(null);
    setStatus("running");
    if (!sid) return;
    try {
      await fetchJson(`/api/sessions/${sid}/upload-result`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploadId: req.uploadId, success: false }),
      });
      const data = await fetchJson<SessionDetail>(`/api/sessions/${sid}`);
      setMessages(data.messages);
    } catch {
      /* best effort */
    }
  }, []);

  /* ---- Render ---- */
  const displayTitle = title?.trim() || (sessionId ? "Untitled" : "New session");

  return (
    <div className="flex h-full min-w-[400px] flex-1 flex-col border-r border-slate-800 last:border-r-0">
      {/* Header */}
      <header className="flex items-center justify-between gap-2 border-b border-slate-800 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-slate-100">{displayTitle}</div>
          <div className="truncate text-[11px] text-slate-500">
            {sessionId ? sessionId.slice(0, 12) + "…" : "Not created"}
          </div>
        </div>
        <button
          className="shrink-0 rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-slate-300"
          onClick={onClose}
          type="button"
          aria-label="Close panel"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4">
            <path d="M5.28 4.22a.75.75 0 0 0-1.06 1.06L6.94 8l-2.72 2.72a.75.75 0 1 0 1.06 1.06L8 9.06l2.72 2.72a.75.75 0 1 0 1.06-1.06L9.06 8l2.72-2.72a.75.75 0 0 0-1.06-1.06L8 6.94 5.28 4.22Z" />
          </svg>
        </button>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {error && (
          <div className="mb-3 rounded border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
            {error}
          </div>
        )}
        {isLoadingSession ? (
          <div className="text-xs text-slate-400">Loading…</div>
        ) : messages.filter((m) => m.role !== "tool").length === 0 ? (
          <div className="rounded border border-dashed border-slate-800 p-4 text-xs text-slate-500">
            Send a message to start.
          </div>
        ) : (
          <div className="space-y-3">
            {messages
              .filter((m) => m.role !== "tool")
              .map((msg, idx) => {
                const style = roleStyles[msg.role];
                return (
                  <div key={`${msg.role}-${idx}`} className={`rounded border px-3 py-2 ${style.tone} fade-in`}>
                    <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-300">
                      <span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold ${style.chip}`}>
                        {style.label}
                      </span>
                    </div>
                    {msg.content ? (
                      <p className="whitespace-pre-wrap text-xs leading-relaxed text-slate-100">{msg.content}</p>
                    ) : (
                      <p className="text-xs text-slate-400">No content</p>
                    )}
                    {msg.images && msg.images.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {msg.images.map((url, i) => (
                          <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                            <img
                              src={url}
                              alt={`Image ${i + 1}`}
                              className="h-24 max-w-[160px] rounded border border-slate-700 object-cover hover:border-slate-500"
                            />
                          </a>
                        ))}
                      </div>
                    )}
                    {msg.role === "assistant" && msg.tool_calls && msg.tool_calls.length > 0 && (
                      <div className="mt-2 rounded border border-slate-800 bg-slate-950/70 px-2 py-1.5 text-[10px] text-slate-200">
                        {summarizeToolCalls(msg.tool_calls)}
                      </div>
                    )}
                  </div>
                );
              })}
            {streamingReply !== null && (
              <div className="rounded border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 fade-in">
                <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-300">
                  <span className="rounded bg-emerald-600 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-50">
                    Assistant
                  </span>
                </div>
                {streamingReply.length > 0 ? (
                  <p className="whitespace-pre-wrap text-xs leading-relaxed text-slate-100">{streamingReply}</p>
                ) : (
                  <p className="text-xs text-slate-400">Streaming…</p>
                )}
                {streamingTools.length > 0 && (
                  <div className="mt-2 rounded border border-slate-800 bg-slate-950/70 px-2 py-1.5 text-[10px] text-slate-200">
                    {mergeStreamingSummaries(streamingTools)}
                  </div>
                )}
              </div>
            )}
            <div ref={endRef} />
          </div>
        )}
      </div>

      {/* Input */}
      <footer className="border-t border-slate-800 px-4 py-3">
        <div className="flex flex-col gap-2">
          {pendingImages.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {pendingImages.map((url, i) => (
                <div key={url} className="group relative">
                  <img src={url} alt={`Pending ${i + 1}`} className="h-12 w-12 rounded border border-slate-700 object-cover" />
                  <button
                    className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-slate-700 text-[8px] text-slate-200 opacity-0 transition group-hover:opacity-100 hover:bg-rose-500"
                    onClick={() => setPendingImages((prev) => prev.filter((_, idx) => idx !== i))}
                    type="button"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
          <div
            className={`relative rounded border transition ${isDragOver ? "border-emerald-400 bg-emerald-500/10" : "border-slate-700"}`}
            onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setIsDragOver(false); void handleImageFiles(Array.from(e.dataTransfer.files)); }}
          >
            <textarea
              className="h-20 w-full resize-none rounded bg-slate-900 px-3 py-2 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
              placeholder={isDragOver ? "松开以上传图片…" : "Type message… (Enter to send)"}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (isComposing) return;
                const native = e.nativeEvent;
                const composing =
                  typeof native === "object" && native !== null && "isComposing" in native && (native as { isComposing?: boolean }).isComposing === true;
                if (composing) return;
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void sendMessage();
                }
              }}
              onPaste={(e) => {
                const files = Array.from(e.clipboardData.files);
                if (files.some((f) => f.type.startsWith("image/"))) {
                  e.preventDefault();
                  void handleImageFiles(files);
                }
              }}
              onCompositionStart={() => setIsComposing(true)}
              onCompositionEnd={() => setIsComposing(false)}
              disabled={isSending}
            />
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { void handleImageFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
              <button
                className="rounded border border-slate-700 px-2 py-1 text-[10px] text-slate-300 hover:border-slate-500 disabled:opacity-40"
                onClick={() => fileInputRef.current?.click()}
                type="button"
                disabled={isSending || isUploading}
              >
                {isUploading ? "…" : "图片"}
              </button>
              <button
                className="rounded border border-slate-700 px-2 py-1 text-[10px] text-slate-300 hover:border-slate-500 disabled:opacity-40"
                onClick={openManualUpload}
                type="button"
                disabled={isSending || !!uploadDialog}
                title="上传文件到指定接口"
              >
                文件
              </button>
            </div>
            {isStreaming ? (
              <button className="rounded bg-rose-500 px-3 py-1 text-xs font-semibold text-white hover:bg-rose-600" onClick={stopStreaming} type="button">
                Stop
              </button>
            ) : (
              <button
                className="rounded bg-emerald-500 px-3 py-1 text-xs font-semibold text-emerald-950 disabled:opacity-60"
                onClick={() => void sendMessage()}
                disabled={isSending || input.trim().length === 0}
                type="button"
              >
                Send
              </button>
            )}
          </div>
        </div>
      </footer>

      {/* Upload dialog — inline within panel */}
      {uploadDialog && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-lg border border-slate-700 bg-slate-900 p-4 shadow-2xl">
            <div className="mb-3 text-sm font-semibold text-slate-100">
              {uploadDialog.purpose || "上传文件"}
            </div>
            <div className="space-y-2">
              <div>
                <label className="mb-1 block text-[10px] text-slate-400">Endpoint</label>
                <input
                  className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100"
                  value={uploadDialog.endpoint}
                  onChange={(e) => setUploadDialog((prev) => prev ? { ...prev, endpoint: e.target.value } : prev)}
                  placeholder="https://..."
                />
              </div>
              {uploadDialog.maxSizeMB && (
                <div className="text-[10px] text-slate-400">最大: {uploadDialog.maxSizeMB}MB</div>
              )}
              {uploadProgress ? (
                <div className="rounded border border-sky-500/40 bg-sky-500/10 px-2 py-1.5 text-xs text-sky-100">
                  {uploadProgress}
                </div>
              ) : (
                <input
                  type="file"
                  accept={uploadDialog.accept || undefined}
                  className="w-full text-xs text-slate-300 file:mr-2 file:rounded file:border-0 file:bg-slate-700 file:px-2 file:py-1 file:text-xs file:text-slate-100"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (uploadDialog.maxSizeMB && file.size > uploadDialog.maxSizeMB * 1024 * 1024) {
                      setError(`文件超过 ${uploadDialog.maxSizeMB}MB 限制`);
                      return;
                    }
                    if (!uploadDialog.endpoint.trim()) {
                      setError("请填写 endpoint");
                      return;
                    }
                    void executeUpload(uploadDialog, file);
                  }}
                />
              )}
            </div>
            <div className="mt-3 flex justify-end">
              <button
                className="rounded border border-slate-700 px-3 py-1 text-xs text-slate-300 hover:border-slate-500"
                onClick={() => void cancelUpload(uploadDialog)}
                type="button"
                disabled={!!uploadProgress}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
