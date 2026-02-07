"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
};

type SessionSummary = {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
};

type SessionDetail = {
  id: string;
  title: string | null;
  messages: ChatMessage[];
};

type SkillSummary = {
  name: string;
  description: string;
  tags: string[];
  productionVersion: number;
};
type SkillDetail = {
  name: string;
  description: string;
  content: string;
  tags: string[];
  metadata: unknown;
  version: number;
  productionVersion: number;
};

type SkillVersionSummary = {
  version: number;
  description: string;
  isProduction: boolean;
  createdAt: string;
};

type McpSummary = {
  name: string;
  description: string | null;
  enabled: boolean;
  productionVersion: number;
  createdAt: string;
  updatedAt: string;
};
type McpDetail = {
  name: string;
  description: string | null;
  code: string;
  enabled: boolean;
  config: unknown;
  version: number;
  productionVersion: number;
};

type McpVersionSummary = {
  version: number;
  description: string | null;
  isProduction: boolean;
  createdAt: string;
};

type ResourceSelection =
  | { type: "skill"; name: string }
  | { type: "mcp"; name: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getErrorMessage(value: unknown, fallback: string): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message;
  if (isRecord(value)) {
    const err = value.error;
    if (typeof err === "string") return err;
  }
  return fallback;
}

async function fetchJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init);
  const data: unknown = await res.json();
  if (!res.ok) {
    throw new Error(getErrorMessage(data, `Request failed (${res.status})`));
  }
  return data as T;
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseTags(input: string): string[] {
  return input
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

function joinTags(tags: string[]): string {
  return tags.join(", ");
}
function extractToolInfo(calls: ToolCall[] | undefined): {
  tools: string[];
  skills: string[];
} {
  if (!calls || calls.length === 0) return { tools: [], skills: [] };
  const toolNames = new Set<string>();
  const skillNames = new Set<string>();
  for (const call of calls) {
    const name = call.function.name;
    toolNames.add(name);
    if (name.startsWith("skills__")) {
      const args = parseJsonObject(call.function.arguments);
      const skillName = args && typeof args.name === "string" ? args.name : null;
      if (skillName && skillName.trim().length > 0) {
        skillNames.add(skillName.trim());
      }
    }
  }
  return { tools: [...toolNames], skills: [...skillNames] };
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
const USER_STORAGE_KEY = "agentForge.user";

export default function Home() {
  const [userName, setUserName] = useState<string>("default");
  const [userDraft, setUserDraft] = useState<string>("default");
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeSession, setActiveSession] = useState<{
    id: string;
    title: string | null;
  } | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [isLoadingSession, setIsLoadingSession] = useState(false);
  const [isGeneratingTitle, setIsGeneratingTitle] = useState(false);
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [mcps, setMcps] = useState<McpSummary[]>([]);
  const [isLoadingResources, setIsLoadingResources] = useState(false);
  const [selectedResource, setSelectedResource] = useState<ResourceSelection | null>(
    null,
  );
  const [skillDetail, setSkillDetail] = useState<SkillDetail | null>(null);
  const [skillVersions, setSkillVersions] = useState<SkillVersionSummary[]>([]);
  const [skillEdit, setSkillEdit] = useState<{ description: string; content: string; tags: string }>({
    description: "",
    content: "",
    tags: "",
  });
  const [mcpDetail, setMcpDetail] = useState<McpDetail | null>(null);
  const [mcpVersions, setMcpVersions] = useState<McpVersionSummary[]>([]);
  const [mcpEdit, setMcpEdit] = useState<{ description: string; code: string }>({
    description: "",
    code: "",
  });
  const [isLoadingResourceDetail, setIsLoadingResourceDetail] = useState(false);
  const [isSavingResource, setIsSavingResource] = useState(false);
  const [isDeletingResource, setIsDeletingResource] = useState(false);
  const [isPublishingVersion, setIsPublishingVersion] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingReply, setStreamingReply] = useState<string | null>(null);
  const [streamingTools, setStreamingTools] = useState<string[]>([]);
  const [isComposing, setIsComposing] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  const selectedResourceRef = useRef<string | null>(null);

  useEffect(() => {
    activeSessionIdRef.current = activeSession?.id ?? null;
  }, [activeSession?.id]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem(USER_STORAGE_KEY);
    if (saved && saved.trim().length > 0) {
      setUserName(saved);
      setUserDraft(saved);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const next = userDraft.trim();
    if (next.length > 0) {
      window.localStorage.setItem(USER_STORAGE_KEY, next);
    } else {
      window.localStorage.removeItem(USER_STORAGE_KEY);
    }
  }, [userDraft]);

  useEffect(() => {
    selectedResourceRef.current = selectedResource
      ? `${selectedResource.type}:${selectedResource.name}`
      : null;
  }, [selectedResource]);

  const activeSessionTitle = useMemo(() => {
    if (!activeSession?.id) return null;
    if (activeSession.title) return activeSession.title;
    const fallback = sessions.find((session) => session.id === activeSession.id);
    return fallback?.title ?? null;
  }, [activeSession, sessions]);

  const dbSkills = useMemo(
    () => skills.filter((skill) => skill.productionVersion > 0),
    [skills],
  );

  const refreshSessions = useCallback(async () => {
    setIsLoadingSessions(true);
    try {
      const data = await fetchJson<SessionSummary[]>(
        `/api/sessions?user=${encodeURIComponent(userName)}`,
      );
      setSessions(data);
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to load sessions."));
    } finally {
      setIsLoadingSessions(false);
    }
  }, [userName]);

  const loadSession = useCallback(async (id: string) => {
    setIsLoadingSession(true);
    setError(null);
    setActiveSession({ id, title: null });
    try {
      const data = await fetchJson<SessionDetail>(`/api/sessions/${id}`);
      if (activeSessionIdRef.current !== id) return;
      setActiveSession({ id: data.id, title: data.title });
      setMessages(data.messages);
    } catch (err: unknown) {
      if (activeSessionIdRef.current === id) {
        setError(getErrorMessage(err, "Failed to load session."));
      }
    } finally {
      if (activeSessionIdRef.current === id) {
        setIsLoadingSession(false);
      }
    }
  }, []);

  const loadResources = useCallback(async () => {
    setIsLoadingResources(true);
    try {
      const [skillsData, mcpsData] = await Promise.all([
        fetchJson<SkillSummary[]>("/api/skills"),
        fetchJson<McpSummary[]>("/api/mcps"),
      ]);
      setSkills(skillsData);
      setMcps(mcpsData);
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to load resources."));
    } finally {
      setIsLoadingResources(false);
    }
  }, []);

  const loadResourceDetail = useCallback(async (resource: ResourceSelection) => {
    const key = `${resource.type}:${resource.name}`;
    selectedResourceRef.current = key;
    setIsLoadingResourceDetail(true);
    setError(null);
    setNotice(null);
    setSelectedResource(resource);
    try {
      if (resource.type === "skill") {
        const [detail, versions] = await Promise.all([
          fetchJson<SkillDetail>(`/api/skills/${resource.name}`),
          fetchJson<SkillVersionSummary[]>(`/api/skills/${resource.name}/versions`),
        ]);
        if (selectedResourceRef.current !== key) return;
        setSkillDetail(detail);
        setSkillVersions(versions);
        setSkillEdit({
          description: detail.description,
          content: detail.content,
          tags: joinTags(detail.tags),
        });
        setMcpDetail(null);
        setMcpVersions([]);
      } else {
        const [detail, versions] = await Promise.all([
          fetchJson<McpDetail>(`/api/mcps/${resource.name}`),
          fetchJson<McpVersionSummary[]>(`/api/mcps/${resource.name}/versions`),
        ]);
        if (selectedResourceRef.current !== key) return;
        setMcpDetail(detail);
        setMcpVersions(versions);
        setMcpEdit({
          description: detail.description ?? "",
          code: detail.code,
        });
        setSkillDetail(null);
        setSkillVersions([]);
      }
    } catch (err: unknown) {
      if (selectedResourceRef.current === key) {
        setError(getErrorMessage(err, "Failed to load resource."));
      }
    } finally {
      if (selectedResourceRef.current === key) {
        setIsLoadingResourceDetail(false);
      }
    }
  }, []);

  const saveSkillVersion = useCallback(async () => {
    if (!skillDetail) return;
    const description = skillEdit.description.trim();
    const content = skillEdit.content.trim();
    if (!description || !content) {
      setError("Description and content are required.");
      return;
    }
    const tags = parseTags(skillEdit.tags);
    setIsSavingResource(true);
    setError(null);
    setNotice(null);
    try {
      const result = await fetchJson<{
        skill: { name: string; productionVersion: number; tags: string[] };
        version: { version: number };
      }>(`/api/skills/${skillDetail.name}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description, content, tags, promote: false }),
      });
      setNotice(`已提交版本 v${result.version.version}（未发布）`);
      await loadResources();
      const versions = await fetchJson<SkillVersionSummary[]>(
        `/api/skills/${skillDetail.name}/versions`,
      );
      setSkillVersions(versions);
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to save skill version."));
    } finally {
      setIsSavingResource(false);
    }
  }, [loadResources, skillDetail, skillEdit]);

  const saveMcpVersion = useCallback(async () => {
    if (!mcpDetail) return;
    const description = mcpEdit.description.trim();
    const code = mcpEdit.code.trim();
    if (!code) {
      setError("Code is required.");
      return;
    }
    setIsSavingResource(true);
    setError(null);
    setNotice(null);
    try {
      const result = await fetchJson<{
        record: { name: string; productionVersion: number };
        version: { version: number };
        loadError?: string;
      }>(`/api/mcps/${mcpDetail.name}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description, code, promote: false }),
      });
      setNotice(`已提交版本 v${result.version.version}（未发布）`);
      await loadResources();
      const versions = await fetchJson<McpVersionSummary[]>(
        `/api/mcps/${mcpDetail.name}/versions`,
      );
      setMcpVersions(versions);
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to save MCP version."));
    } finally {
      setIsSavingResource(false);
    }
  }, [loadResources, mcpDetail, mcpEdit]);

  const publishSkillVersion = useCallback(
    async (version: number) => {
      if (!skillDetail) return;
      setIsPublishingVersion(true);
      setError(null);
      setNotice(null);
      try {
        await fetchJson<{ name: string; productionVersion: number }>(
          `/api/skills/${skillDetail.name}/production`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ version }),
          },
        );
        await loadResources();
        const [detail, versions] = await Promise.all([
          fetchJson<SkillDetail>(`/api/skills/${skillDetail.name}`),
          fetchJson<SkillVersionSummary[]>(
            `/api/skills/${skillDetail.name}/versions`,
          ),
        ]);
        setSkillDetail(detail);
        setSkillVersions(versions);
        setNotice(`已发布版本 v${version}`);
      } catch (err: unknown) {
        setError(getErrorMessage(err, "Failed to publish skill version."));
      } finally {
        setIsPublishingVersion(false);
      }
    },
    [loadResources, skillDetail],
  );

  const publishMcpVersion = useCallback(
    async (version: number) => {
      if (!mcpDetail) return;
      setIsPublishingVersion(true);
      setError(null);
      setNotice(null);
      try {
        const result = await fetchJson<{
          name: string;
          productionVersion: number;
          loadError?: string;
        }>(`/api/mcps/${mcpDetail.name}/production`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ version }),
        });
        if (result.loadError) {
          setError(`Published but load error: ${result.loadError}`);
        } else {
          setNotice(`已发布版本 v${version}`);
        }
        await loadResources();
        const [detail, versions] = await Promise.all([
          fetchJson<McpDetail>(`/api/mcps/${mcpDetail.name}`),
          fetchJson<McpVersionSummary[]>(`/api/mcps/${mcpDetail.name}/versions`),
        ]);
        setMcpDetail(detail);
        setMcpVersions(versions);
      } catch (err: unknown) {
        setError(getErrorMessage(err, "Failed to publish MCP version."));
      } finally {
        setIsPublishingVersion(false);
      }
    },
    [loadResources, mcpDetail],
  );

  const deleteSelectedResource = useCallback(async () => {
    if (!selectedResource) return;
    setIsDeletingResource(true);
    setError(null);
    setNotice(null);
    try {
      const endpoint =
        selectedResource.type === "skill"
          ? `/api/skills/${selectedResource.name}`
          : `/api/mcps/${selectedResource.name}`;
      await fetchJson<{ deleted: string }>(endpoint, { method: "DELETE" });
      setSelectedResource(null);
      setSkillDetail(null);
      setSkillVersions([]);
      setMcpDetail(null);
      setMcpVersions([]);
      await loadResources();
      setNotice("已删除资源");
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to delete resource."));
    } finally {
      setIsDeletingResource(false);
    }
  }, [loadResources, selectedResource]);

  useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

  useEffect(() => {
    void loadResources();
  }, [loadResources]);
  useEffect(() => {
    if (!selectedResource) return;
    if (selectedResource.type === "skill") {
      const exists = dbSkills.some((skill) => skill.name === selectedResource.name);
      if (!exists) {
        setSelectedResource(null);
        setSkillDetail(null);
        setSkillVersions([]);
      }
      return;
    }
    const exists = mcps.some((mcp) => mcp.name === selectedResource.name);
    if (!exists) {
      setSelectedResource(null);
      setMcpDetail(null);
      setMcpVersions([]);
    }
  }, [dbSkills, mcps, selectedResource]);


  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingReply, streamingTools]);

  const startNewChat = useCallback(() => {
    setActiveSession(null);
    setMessages([]);
    setInput("");
    setError(null);
    setIsStreaming(false);
    setStreamingReply(null);
    setStreamingTools([]);
  }, []);

  const generateTitle = useCallback(async (id: string, seed: string) => {
    setIsGeneratingTitle(true);
    try {
      const result = await fetchJson<{ id: string; title: string }>(
        `/api/sessions/${id}/title`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: seed }),
        },
      );
      setActiveSession((prev) => {
        if (!prev || prev.id !== id) return prev;
        if (prev.title && prev.title.trim().length > 0) return prev;
        return { ...prev, title: result.title };
      });
      setSessions((prev) =>
        prev.map((s) => (s.id === id ? { ...s, title: result.title } : s)),
      );
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to generate title."));
    } finally {
      setIsGeneratingTitle(false);
    }
  }, []);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || isSending) return;
    setError(null);
    setNotice(null);
    setIsSending(true);
    setIsStreaming(true);
    setInput("");
    const wasNewSession = !activeSession;
    const sessionId = activeSession?.id ?? undefined;
    let streamSessionId: string | null = sessionId ?? null;
    let doneSessionId: string | null = null;
    let streamError: string | null = null;
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setStreamingReply("");
    setStreamingTools([]);

    try {
      const payload: Record<string, unknown> = {
        message: text,
        user: userName,
      };
      if (sessionId) payload.session_id = sessionId;

      const res = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok || !res.body) {
        throw new Error(`Stream failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const handleEvent = (raw: string) => {
        const lines = raw.split(/\r?\n/);
        let event = "message";
        const dataLines: string[] = [];
        for (const line of lines) {
          if (line.startsWith("event:")) {
            event = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).trim());
          }
        }
        if (dataLines.length === 0) return;
        const dataStr = dataLines.join("\n");
        let payloadData: unknown;
        try {
          payloadData = JSON.parse(dataStr);
        } catch {
          return;
        }

        if (!isRecord(payloadData)) return;

        if (event === "session") {
          const sid = payloadData.session_id;
          if (typeof sid === "string") {
            streamSessionId = sid;
            setActiveSession((prev) =>
              prev ? { ...prev, id: sid } : { id: sid, title: null },
            );
          }
        } else if (event === "delta") {
          const delta = payloadData.text;
          if (typeof delta === "string") {
            setStreamingReply((prev) => (prev ?? "") + delta);
          }
        } else if (event === "tool") {
          const summary = payloadData.summary;
          if (typeof summary === "string") {
            setStreamingTools((prev) =>
              prev.includes(summary) ? prev : [...prev, summary],
            );
          }
        } else if (event === "done") {
          const sid = payloadData.session_id;
          if (typeof sid === "string") {
            doneSessionId = sid;
          }
        } else if (event === "error") {
          const errMsg = payloadData.error;
          if (typeof errMsg === "string") {
            streamError = errMsg;
          }
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary = buffer.indexOf("\n\n");
        while (boundary !== -1) {
          const chunk = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          handleEvent(chunk);
          boundary = buffer.indexOf("\n\n");
        }
      }

      if (streamError) {
        setError(streamError);
        return;
      }

      const finalSessionId = doneSessionId ?? streamSessionId;
      if (finalSessionId) {
        await refreshSessions();
        await loadSession(finalSessionId);
        if (wasNewSession) {
          void generateTitle(finalSessionId, text);
        }
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to stream message."));
    } finally {
      setIsSending(false);
      setIsStreaming(false);
      setStreamingReply(null);
      setStreamingTools([]);
    }
  }, [
    activeSession,
    generateTitle,
    input,
    isSending,
    loadSession,
    refreshSessions,
    userName,
  ]);


  const deleteSession = useCallback(async () => {
    if (!activeSession) return;
    setError(null);
    try {
      await fetchJson<{ deleted: string }>(`/api/sessions/${activeSession.id}`, {
        method: "DELETE",
      });
      startNewChat();
      await refreshSessions();
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to delete session."));
    }
  }, [activeSession, refreshSessions, startNewChat]);

  const applyUserName = useCallback(() => {
    const nextUser = userDraft.trim() || "default";
    setUserName(nextUser);
    setActiveSession(null);
    setMessages([]);
    setError(null);
    setIsStreaming(false);
    setStreamingReply(null);
    setStreamingTools([]);
  }, [userDraft]);

  return (
    <main className="flex h-screen w-full bg-slate-950 text-slate-100">
      <aside className="flex h-full w-72 shrink-0 flex-col border-r border-slate-800 bg-slate-950/80 p-4">
        <div className="mb-6">
          <div className="text-lg font-semibold">Agent Forge</div>
          <div className="text-xs text-slate-400">Chat-first agent console</div>
        </div>

        <div className="mb-4 space-y-2">
          <label className="text-xs uppercase tracking-wide text-slate-400">User</label>
          <div className="flex gap-2">
            <input
              className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
              value={userDraft}
              onChange={(event) => setUserDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  applyUserName();
                }
              }}
              placeholder="default"
            />
            <button
              className="rounded border border-slate-700 px-3 text-sm text-slate-100 hover:border-slate-500"
              onClick={applyUserName}
              type="button"
            >
              Switch
            </button>
          </div>
        </div>

        <div className="mb-3 flex items-center justify-between">
          <div className="text-xs uppercase tracking-wide text-slate-400">
            Sessions
          </div>
          <button
            className="text-xs text-slate-300 hover:text-white"
            onClick={refreshSessions}
            type="button"
          >
            {isLoadingSessions ? "Loading..." : "Refresh"}
          </button>
        </div>

        <button
          className="mb-4 rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 hover:border-slate-500"
          onClick={startNewChat}
          type="button"
        >
          + New Chat
        </button>

        <div className="flex-1 overflow-y-auto pr-1">
          {sessions.length === 0 ? (
            <div className="rounded border border-dashed border-slate-800 p-4 text-xs text-slate-500">
              No sessions yet.
            </div>
          ) : (
            <ul className="space-y-2">
              {sessions.map((session) => {
                const isActive = session.id === activeSession?.id;
                return (
                  <li key={session.id}>
                    <button
                      className={`w-full rounded border px-3 py-2 text-left text-sm transition ${
                        isActive
                          ? "border-emerald-400 bg-emerald-500/10"
                          : "border-slate-800 bg-slate-900/40 hover:border-slate-600"
                      }`}
                      onClick={() => loadSession(session.id)}
                      type="button"
                    >
                      <div className="font-medium text-slate-100">
                        {session.title?.trim() || "Untitled session"}
                      </div>
                      <div className="text-xs text-slate-400">
                        {formatTimestamp(session.updatedAt)}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-6 py-4">
          <div>
            <div className="text-lg font-semibold">
              {activeSessionTitle || "New session"}
            </div>
            <div className="text-xs text-slate-400">
              {activeSession?.id ? `Session ID: ${activeSession.id}` : "Not created yet"}
              {isGeneratingTitle ? " · Generating title..." : null}
            </div>
          </div>
          {activeSession && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                className="rounded border border-rose-500/60 px-3 py-2 text-sm text-rose-100 hover:bg-rose-500/10"
                onClick={deleteSession}
                type="button"
              >
                Delete
              </button>
            </div>
          )}
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-6">
          {error && (
            <div className="mb-4 rounded border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
              {error}
            </div>
          )}
          {notice && (
            <div className="mb-4 rounded border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
              {notice}
            </div>
          )}

          {isLoadingSession ? (
            <div className="rounded border border-slate-800 bg-slate-900/40 px-4 py-3 text-sm text-slate-400">
              Loading session...
            </div>
          ) : messages.filter((message) => message.role !== "tool").length === 0 ? (
            <div className="rounded border border-dashed border-slate-800 p-6 text-sm text-slate-500">
              Start a conversation to see messages here.
            </div>
          ) : (
            <div className="space-y-4">
              {messages
                .filter((message) => message.role !== "tool")
                .map((message, index) => {
                const style = roleStyles[message.role];
                const toolInfo =
                  message.role === "assistant"
                    ? extractToolInfo(message.tool_calls)
                    : { tools: [], skills: [] };
                return (
                  <div
                    key={`${message.role}-${index}`}
                    className={`rounded border px-4 py-3 ${style.tone} fade-in`}
                  >
                    <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-200">
                      <span
                        className={`rounded px-2 py-0.5 text-[10px] font-semibold ${style.chip}`}
                      >
                        {style.label}
                      </span>
                    </div>
                    {message.content ? (
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-100">
                        {message.content}
                      </p>
                    ) : (
                      <p className="text-sm text-slate-400">No content</p>
                    )}
                    {message.role === "assistant" &&
                    (toolInfo.tools.length > 0 || toolInfo.skills.length > 0) ? (
                      <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-300">
                        {toolInfo.tools.map((tool) => (
                          <span
                            key={`tool-${tool}`}
                            className="rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5"
                          >
                            tool: {tool}
                          </span>
                        ))}
                        {toolInfo.skills.map((skill) => (
                          <span
                            key={`skill-${skill}`}
                            className="rounded-full border border-emerald-500/50 bg-emerald-500/10 px-2 py-0.5 text-emerald-100"
                          >
                            skill: {skill}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
              {streamingReply !== null && (
                <div className="rounded border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 fade-in">
                  <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-200">
                    <span className="rounded bg-emerald-600 px-2 py-0.5 text-[10px] font-semibold text-emerald-50">
                      Assistant
                    </span>
                  </div>
                  {streamingReply.length > 0 ? (
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-100">
                      {streamingReply}
                    </p>
                  ) : (
                    <p className="text-sm text-slate-400">Streaming…</p>
                  )}
                  {streamingTools.length > 0 ? (
                    <div className="mt-3 space-y-2">
                      {streamingTools.map((summary) => (
                        <div
                          key={summary}
                          className="rounded border border-slate-800 bg-slate-950/70 p-3 text-xs text-slate-200"
                        >
                          {summary}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              )}
              <div ref={endRef} />
            </div>
          )}
        </div>

        <footer className="border-t border-slate-800 px-6 py-4">
          <div className="flex flex-col gap-3">
            <textarea
              className="h-28 w-full resize-none rounded border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
              placeholder="Type your message… (Enter to send, Shift+Enter for newline)"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (isComposing) return;
                const nativeEvent = event.nativeEvent;
                const composing =
                  typeof nativeEvent === "object" &&
                  nativeEvent !== null &&
                  "isComposing" in nativeEvent &&
                  (nativeEvent as { isComposing?: boolean }).isComposing === true;
                if (composing) return;
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void sendMessage();
                }
              }}
              onCompositionStart={() => setIsComposing(true)}
              onCompositionEnd={() => setIsComposing(false)}
              disabled={isSending}
            />
            <div className="flex items-center justify-between">
              <div className="text-xs text-slate-400">
                {activeSession ? "Active session" : "New session"}
              </div>
              <button
                className="rounded bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 disabled:opacity-60"
                onClick={() => void sendMessage()}
                disabled={isSending || input.trim().length === 0}
                type="button"
              >
                {isStreaming ? "Streaming..." : isSending ? "Sending..." : "Send"}
              </button>
            </div>
          </div>
        </footer>
      </section>

      <aside className="hidden h-full w-80 shrink-0 border-l border-slate-800 bg-slate-950/80 p-4 xl:block">
        <div className="mb-4 flex items-center justify-between">
          <div className="text-xs uppercase tracking-wide text-slate-400">
            Resources
          </div>
          <button
            className="text-xs text-slate-300 hover:text-white"
            onClick={loadResources}
            type="button"
          >
            {isLoadingResources ? "Loading..." : "Refresh"}
          </button>
        </div>

        <div className="space-y-6 overflow-y-auto">
          <section>
            <div className="mb-2 text-sm font-semibold text-slate-100">Skills</div>
            {dbSkills.length === 0 ? (
              <div className="rounded border border-dashed border-slate-800 p-3 text-xs text-slate-500">
                No database skills.
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {dbSkills.map((skill) => {
                  const isActive =
                    selectedResource?.type === "skill" &&
                    selectedResource.name === skill.name;
                  return (
                    <button
                      key={skill.name}
                      className={`rounded-full border px-3 py-1 text-xs ${
                        isActive
                          ? "border-emerald-400 bg-emerald-500/20 text-emerald-100"
                          : "border-slate-700 bg-slate-900/60 text-slate-300 hover:border-slate-500"
                      }`}
                      title={skill.description}
                      onClick={() =>
                        loadResourceDetail({ type: "skill", name: skill.name })
                      }
                      type="button"
                    >
                      {skill.name}
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          <section>
            <div className="mb-2 text-sm font-semibold text-slate-100">MCPs</div>
            {mcps.length === 0 ? (
              <div className="rounded border border-dashed border-slate-800 p-3 text-xs text-slate-500">
                No MCP servers yet.
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {mcps.map((mcp) => {
                  const isActive =
                    selectedResource?.type === "mcp" &&
                    selectedResource.name === mcp.name;
                  return (
                    <button
                      key={mcp.name}
                      className={`rounded-full border px-3 py-1 text-xs ${
                        isActive
                          ? "border-sky-400 bg-sky-500/20 text-sky-100"
                          : "border-slate-700 bg-slate-900/60 text-slate-300 hover:border-slate-500"
                      }`}
                      title={mcp.description ?? "No description"}
                      onClick={() =>
                        loadResourceDetail({ type: "mcp", name: mcp.name })
                      }
                      type="button"
                    >
                      {mcp.name}
                    </button>
                  );
                })}
              </div>
            )}
          </section>

        </div>
      </aside>

      {selectedResource && (
        <div className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/40 backdrop-blur-sm">
          <button
            className="absolute inset-0 h-full w-full cursor-pointer"
            onClick={() => setSelectedResource(null)}
            type="button"
            aria-label="Close"
          />
          <section className="relative z-10 h-full w-[90vw] max-w-[1400px] overflow-y-auto border-l border-slate-800 bg-slate-950 p-6 shadow-2xl drawer-in">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-wide text-slate-400">
                  Detail
                </div>
                <div className="text-lg font-semibold text-slate-100">
                  {selectedResource.type === "skill" ? "Skill" : "MCP"} ·{" "}
                  {selectedResource.name}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="rounded border border-rose-500/70 px-3 py-1 text-xs text-rose-100 hover:bg-rose-500/10"
                  onClick={deleteSelectedResource}
                  type="button"
                  disabled={isDeletingResource}
                >
                  {isDeletingResource ? "Deleting..." : "Delete"}
                </button>
              </div>
            </div>

            {isLoadingResourceDetail ? (
              <div className="rounded border border-slate-800 bg-slate-900/40 px-4 py-3 text-sm text-slate-400">
                Loading detail...
              </div>
            ) : selectedResource.type === "skill" && skillDetail ? (
              <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
                <div className="space-y-4">
                  <div className="rounded border border-slate-800 bg-slate-900/40 p-4">
                    <div className="text-sm font-semibold text-slate-100">
                      {skillDetail.name}
                    </div>
                    <div className="mt-1 text-xs text-slate-400">
                      Production v{skillDetail.productionVersion}
                    </div>
                    {skillDetail.tags.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {skillDetail.tags.map((tag) => (
                          <span
                            key={tag}
                            className="rounded bg-slate-800 px-2 py-0.5 text-[10px] text-slate-400"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  <div className="rounded border border-slate-800 bg-slate-900/40 p-4 space-y-3">
                    <label className="text-xs text-slate-400">Description</label>
                    <textarea
                      className="h-24 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                      value={skillEdit.description}
                      onChange={(event) =>
                        setSkillEdit((prev) => ({
                          ...prev,
                          description: event.target.value,
                        }))
                      }
                    />
                    <label className="text-xs text-slate-400">Content</label>
                    <textarea
                      className="h-64 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                      value={skillEdit.content}
                      onChange={(event) =>
                        setSkillEdit((prev) => ({
                          ...prev,
                          content: event.target.value,
                        }))
                      }
                    />
                    <label className="text-xs text-slate-400">Tags</label>
                    <input
                      className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                      value={skillEdit.tags}
                      onChange={(event) =>
                        setSkillEdit((prev) => ({
                          ...prev,
                          tags: event.target.value,
                        }))
                      }
                      placeholder="tag-a, tag-b"
                    />
                    <div className="flex justify-end">
                      <button
                        className="rounded border border-emerald-500/60 px-4 py-2 text-sm text-emerald-100 hover:bg-emerald-500/10"
                        onClick={saveSkillVersion}
                        type="button"
                        disabled={isSavingResource}
                      >
                        {isSavingResource ? "Saving..." : "提交新版本"}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="rounded border border-slate-800 bg-slate-900/40 p-4">
                  <div className="mb-3 text-sm font-semibold text-slate-100">
                    Versions
                  </div>
                  {skillVersions.length === 0 ? (
                    <div className="text-xs text-slate-500">No versions.</div>
                  ) : (
                    <ul className="space-y-3">
                      {skillVersions.map((version) => (
                        <li
                          key={version.version}
                          className="rounded border border-slate-800 bg-slate-950/60 px-3 py-3"
                        >
                          <div className="flex items-center justify-between text-sm">
                            <span>v{version.version}</span>
                            {version.isProduction ? (
                              <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[11px] text-emerald-100">
                                Production
                              </span>
                            ) : (
                              <button
                                className="text-[11px] text-sky-300 hover:text-sky-200"
                                onClick={() => publishSkillVersion(version.version)}
                                type="button"
                                disabled={isPublishingVersion}
                              >
                                发布
                              </button>
                            )}
                          </div>
                          <div className="mt-2 text-[12px] text-slate-300">
                            {version.description}
                          </div>
                          <div className="mt-1 text-[11px] text-slate-500">
                            {formatTimestamp(version.createdAt)}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ) : selectedResource.type === "mcp" && mcpDetail ? (
              <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
                <div className="space-y-4">
                  <div className="rounded border border-slate-800 bg-slate-900/40 p-4">
                    <div className="text-sm font-semibold text-slate-100">
                      {mcpDetail.name}
                    </div>
                    <div className="mt-1 text-xs text-slate-400">
                      Production v{mcpDetail.productionVersion}
                    </div>
                    <div className="mt-1 text-[11px] text-slate-500">
                      {mcpDetail.enabled ? "Enabled" : "Disabled"}
                    </div>
                  </div>

                  <div className="rounded border border-slate-800 bg-slate-900/40 p-4 space-y-3">
                    <label className="text-xs text-slate-400">Description</label>
                    <textarea
                      className="h-24 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                      value={mcpEdit.description}
                      onChange={(event) =>
                        setMcpEdit((prev) => ({
                          ...prev,
                          description: event.target.value,
                        }))
                      }
                    />
                    <label className="text-xs text-slate-400">Code</label>
                    <textarea
                      className="h-64 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                      value={mcpEdit.code}
                      onChange={(event) =>
                        setMcpEdit((prev) => ({
                          ...prev,
                          code: event.target.value,
                        }))
                      }
                    />
                    <div className="flex justify-end">
                      <button
                        className="rounded border border-sky-400/60 px-4 py-2 text-sm text-sky-100 hover:bg-sky-500/10"
                        onClick={saveMcpVersion}
                        type="button"
                        disabled={isSavingResource}
                      >
                        {isSavingResource ? "Saving..." : "提交新版本"}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="rounded border border-slate-800 bg-slate-900/40 p-4">
                  <div className="mb-3 text-sm font-semibold text-slate-100">
                    Versions
                  </div>
                  {mcpVersions.length === 0 ? (
                    <div className="text-xs text-slate-500">No versions.</div>
                  ) : (
                    <ul className="space-y-3">
                      {mcpVersions.map((version) => (
                        <li
                          key={version.version}
                          className="rounded border border-slate-800 bg-slate-950/60 px-3 py-3"
                        >
                          <div className="flex items-center justify-between text-sm">
                            <span>v{version.version}</span>
                            {version.isProduction ? (
                              <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[11px] text-emerald-100">
                                Production
                              </span>
                            ) : (
                              <button
                                className="text-[11px] text-sky-300 hover:text-sky-200"
                                onClick={() => publishMcpVersion(version.version)}
                                type="button"
                                disabled={isPublishingVersion}
                              >
                                发布
                              </button>
                            )}
                          </div>
                          <div className="mt-2 text-[12px] text-slate-300">
                            {version.description || "No description"}
                          </div>
                          <div className="mt-1 text-[11px] text-slate-500">
                            {formatTimestamp(version.createdAt)}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ) : (
              <div className="rounded border border-slate-800 bg-slate-900/40 px-4 py-3 text-sm text-slate-400">
                No detail loaded.
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
