"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgentPanel } from "./components/AgentPanel";
import {
  fetchJson,
  formatTimestamp,
  getErrorMessage,
  joinTags,
  parseTags,
} from "./components/client-utils";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type SessionSummary = {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
};

type SkillSummary = { name: string; description: string; tags: string[]; productionVersion: number };
type SkillDetail = { name: string; description: string; content: string; tags: string[]; metadata: unknown; version: number; productionVersion: number };
type SkillVersionSummary = { version: number; description: string; isProduction: boolean; createdAt: string };

type McpSummary = { name: string; description: string | null; enabled: boolean; productionVersion: number; createdAt: string; updatedAt: string };
type McpDetail = { name: string; description: string | null; code: string; enabled: boolean; config: unknown; version: number; productionVersion: number };
type McpVersionSummary = { version: number; description: string | null; isProduction: boolean; createdAt: string };

type BuiltinMcpSummary = { name: string; available: boolean; active: boolean };
type ResourceSelection = { type: "skill"; name: string } | { type: "mcp"; name: string };

const USER_STORAGE_KEY = "agentForge.user";

export default function Home() {
  const [userName, setUserName] = useState("default");
  const [userDraft, setUserDraft] = useState("default");
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string | undefined>();
  const [panelKey, setPanelKey] = useState(() => crypto.randomUUID());

  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [mcps, setMcps] = useState<McpSummary[]>([]);
  const [builtinMcps, setBuiltinMcps] = useState<BuiltinMcpSummary[]>([]);
  const [isLoadingResources, setIsLoadingResources] = useState(false);

  const [selectedResource, setSelectedResource] = useState<ResourceSelection | null>(null);
  const [skillDetail, setSkillDetail] = useState<SkillDetail | null>(null);
  const [skillVersions, setSkillVersions] = useState<SkillVersionSummary[]>([]);
  const [skillEdit, setSkillEdit] = useState({ description: "", content: "", tags: "" });
  const [mcpDetail, setMcpDetail] = useState<McpDetail | null>(null);
  const [mcpVersions, setMcpVersions] = useState<McpVersionSummary[]>([]);
  const [mcpEdit, setMcpEdit] = useState({ description: "", code: "" });
  const [isLoadingResourceDetail, setIsLoadingResourceDetail] = useState(false);
  const [isSavingResource, setIsSavingResource] = useState(false);
  const [isDeletingResource, setIsDeletingResource] = useState(false);
  const [isPublishingVersion, setIsPublishingVersion] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const selectedResourceRef = useRef<string | null>(null);
  const currentSessionIdRef = useRef<string | undefined>(undefined);
  useEffect(() => { currentSessionIdRef.current = currentSessionId; }, [currentSessionId]);

  useEffect(() => { if (typeof window === "undefined") return; const s = window.localStorage.getItem(USER_STORAGE_KEY); if (s && s.trim().length > 0) { setUserName(s); setUserDraft(s); } }, []);
  useEffect(() => { if (typeof window === "undefined") return; const n = userDraft.trim(); if (n.length > 0) window.localStorage.setItem(USER_STORAGE_KEY, n); else window.localStorage.removeItem(USER_STORAGE_KEY); }, [userDraft]);
  useEffect(() => { selectedResourceRef.current = selectedResource ? `${selectedResource.type}:${selectedResource.name}` : null; }, [selectedResource]);

  const builtinSkills = useMemo(() => skills.filter((s) => s.productionVersion === 0), [skills]);
  const dbSkills = useMemo(() => skills.filter((s) => s.productionVersion > 0), [skills]);

  const refreshSessions = useCallback(async () => {
    setIsLoadingSessions(true);
    try { setSessions(await fetchJson<SessionSummary[]>(`/api/sessions?user=${encodeURIComponent(userName)}`)); }
    catch (err: unknown) { setError(getErrorMessage(err, "Failed to load sessions.")); }
    finally { setIsLoadingSessions(false); }
  }, [userName]);

  const loadResources = useCallback(async () => {
    setIsLoadingResources(true);
    try {
      const sid = currentSessionIdRef.current;
      const sp = sid ? `?session=${encodeURIComponent(sid)}` : "";
      const [sk, mc, bm] = await Promise.all([
        fetchJson<SkillSummary[]>("/api/skills"),
        fetchJson<McpSummary[]>("/api/mcps"),
        fetchJson<BuiltinMcpSummary[]>(`/api/mcps/builtins${sp}`),
      ]);
      setSkills(sk); setMcps(mc); setBuiltinMcps(bm);
    } catch (err: unknown) { setError(getErrorMessage(err, "Failed to load resources.")); }
    finally { setIsLoadingResources(false); }
  }, []);

  const loadResourceDetail = useCallback(async (resource: ResourceSelection) => {
    const key = `${resource.type}:${resource.name}`;
    selectedResourceRef.current = key;
    setIsLoadingResourceDetail(true); setError(null); setNotice(null); setSelectedResource(resource);
    try {
      if (resource.type === "skill") {
        const [d, v] = await Promise.all([fetchJson<SkillDetail>(`/api/skills/${resource.name}`), fetchJson<SkillVersionSummary[]>(`/api/skills/${resource.name}/versions`)]);
        if (selectedResourceRef.current !== key) return;
        setSkillDetail(d); setSkillVersions(v); setSkillEdit({ description: d.description, content: d.content, tags: joinTags(d.tags) }); setMcpDetail(null); setMcpVersions([]);
      } else {
        const [d, v] = await Promise.all([fetchJson<McpDetail>(`/api/mcps/${resource.name}`), fetchJson<McpVersionSummary[]>(`/api/mcps/${resource.name}/versions`)]);
        if (selectedResourceRef.current !== key) return;
        setMcpDetail(d); setMcpVersions(v); setMcpEdit({ description: d.description ?? "", code: d.code }); setSkillDetail(null); setSkillVersions([]);
      }
    } catch (err: unknown) { if (selectedResourceRef.current === key) setError(getErrorMessage(err, "Failed to load resource.")); }
    finally { if (selectedResourceRef.current === key) setIsLoadingResourceDetail(false); }
  }, []);

  const saveSkillVersion = useCallback(async () => {
    if (!skillDetail) return;
    const desc = skillEdit.description.trim(), cont = skillEdit.content.trim();
    if (!desc || !cont) { setError("Description and content are required."); return; }
    setIsSavingResource(true); setError(null); setNotice(null);
    try {
      const r = await fetchJson<{ version: { version: number } }>(`/api/skills/${skillDetail.name}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ description: desc, content: cont, tags: parseTags(skillEdit.tags), promote: false }) });
      setNotice(`已提交版本 v${r.version.version}（未发布）`); await loadResources();
      setSkillVersions(await fetchJson<SkillVersionSummary[]>(`/api/skills/${skillDetail.name}/versions`));
    } catch (err: unknown) { setError(getErrorMessage(err, "Failed to save.")); } finally { setIsSavingResource(false); }
  }, [loadResources, skillDetail, skillEdit]);

  const saveMcpVersion = useCallback(async () => {
    if (!mcpDetail) return;
    const code = mcpEdit.code.trim();
    if (!code) { setError("Code is required."); return; }
    setIsSavingResource(true); setError(null); setNotice(null);
    try {
      const r = await fetchJson<{ version: { version: number } }>(`/api/mcps/${mcpDetail.name}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ description: mcpEdit.description.trim(), code, promote: false }) });
      setNotice(`已提交版本 v${r.version.version}（未发布）`); await loadResources();
      setMcpVersions(await fetchJson<McpVersionSummary[]>(`/api/mcps/${mcpDetail.name}/versions`));
    } catch (err: unknown) { setError(getErrorMessage(err, "Failed to save.")); } finally { setIsSavingResource(false); }
  }, [loadResources, mcpDetail, mcpEdit]);

  const publishSkillVersion = useCallback(async (ver: number) => {
    if (!skillDetail) return;
    setIsPublishingVersion(true); setError(null); setNotice(null);
    try {
      await fetchJson(`/api/skills/${skillDetail.name}/production`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: ver }) });
      await loadResources();
      const [d, v] = await Promise.all([fetchJson<SkillDetail>(`/api/skills/${skillDetail.name}`), fetchJson<SkillVersionSummary[]>(`/api/skills/${skillDetail.name}/versions`)]);
      setSkillDetail(d); setSkillVersions(v); setNotice(`已发布版本 v${ver}`);
    } catch (err: unknown) { setError(getErrorMessage(err, "Failed to publish.")); } finally { setIsPublishingVersion(false); }
  }, [loadResources, skillDetail]);

  const publishMcpVersion = useCallback(async (ver: number) => {
    if (!mcpDetail) return;
    setIsPublishingVersion(true); setError(null); setNotice(null);
    try {
      const r = await fetchJson<{ loadError?: string }>(`/api/mcps/${mcpDetail.name}/production`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: ver }) });
      if (r.loadError) setError(`Published but load error: ${r.loadError}`); else setNotice(`已发布版本 v${ver}`);
      await loadResources();
      const [d, v] = await Promise.all([fetchJson<McpDetail>(`/api/mcps/${mcpDetail.name}`), fetchJson<McpVersionSummary[]>(`/api/mcps/${mcpDetail.name}/versions`)]);
      setMcpDetail(d); setMcpVersions(v);
    } catch (err: unknown) { setError(getErrorMessage(err, "Failed to publish.")); } finally { setIsPublishingVersion(false); }
  }, [loadResources, mcpDetail]);

  const deleteSelectedResource = useCallback(async () => {
    if (!selectedResource) return;
    setIsDeletingResource(true); setError(null); setNotice(null);
    try {
      await fetchJson<{ deleted: string }>(selectedResource.type === "skill" ? `/api/skills/${selectedResource.name}` : `/api/mcps/${selectedResource.name}`, { method: "DELETE" });
      setSelectedResource(null); setSkillDetail(null); setSkillVersions([]); setMcpDetail(null); setMcpVersions([]);
      await loadResources(); setNotice("已删除资源");
    } catch (err: unknown) { setError(getErrorMessage(err, "Failed to delete.")); } finally { setIsDeletingResource(false); }
  }, [loadResources, selectedResource]);

  useEffect(() => { void refreshSessions(); }, [refreshSessions]);
  useEffect(() => { void loadResources(); }, [loadResources]);
  useEffect(() => {
    if (!selectedResource) return;
    if (selectedResource.type === "skill") {
      if (!builtinSkills.some((s) => s.name === selectedResource.name) && !dbSkills.some((s) => s.name === selectedResource.name)) { setSelectedResource(null); setSkillDetail(null); setSkillVersions([]); }
      return;
    }
    if (!builtinMcps.some((m) => m.name === selectedResource.name) && !mcps.some((m) => m.name === selectedResource.name)) { setSelectedResource(null); setMcpDetail(null); setMcpVersions([]); }
  }, [builtinSkills, builtinMcps, dbSkills, mcps, selectedResource]);

  /* ---- Session management ---- */
  const switchSession = useCallback((sessionId?: string) => {
    setCurrentSessionId(sessionId);
    setPanelKey(crypto.randomUUID());
  }, []);

  const deleteSessionById = useCallback(async (sessionId: string) => {
    if (!confirm("确定永久删除此会话？")) return;
    try {
      await fetchJson(`/api/sessions/${sessionId}`, { method: "DELETE" });
      if (currentSessionIdRef.current === sessionId) switchSession(undefined);
      await refreshSessions();
      setNotice("已删除会话");
    } catch (err: unknown) { setError(getErrorMessage(err, "Failed to delete session.")); }
  }, [refreshSessions, switchSession]);

  const handleRefresh = useCallback(() => { void refreshSessions(); void loadResources(); }, [refreshSessions, loadResources]);
  const applyUserName = useCallback(() => { setUserName(userDraft.trim() || "default"); switchSession(undefined); }, [userDraft, switchSession]);

  return (
    <main className="flex h-screen w-full bg-slate-950 text-slate-100">
      {/* Left sidebar */}
      <aside className="flex h-full w-56 shrink-0 flex-col border-r border-slate-800 bg-slate-950/80 p-3">
        <div className="mb-3">
          <div className="text-base font-semibold">Agent Forge</div>
          <div className="text-[10px] text-slate-400">Multi-agent console</div>
        </div>
        <div className="mb-3 space-y-1">
          <label className="text-[10px] uppercase tracking-wide text-slate-400">User</label>
          <div className="flex gap-1">
            <input className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-100" value={userDraft} onChange={(e) => setUserDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applyUserName(); } }} placeholder="default" />
            <button className="rounded border border-slate-700 px-1.5 text-[10px] text-slate-100 hover:border-slate-500" onClick={applyUserName} type="button">Go</button>
          </div>
        </div>
        <div className="mb-1.5 flex items-center justify-between">
          <div className="text-[10px] uppercase tracking-wide text-slate-400">Sessions</div>
          <div className="flex items-center gap-1.5">
            <button className="text-[10px] text-slate-300 hover:text-white" onClick={() => switchSession(undefined)} type="button" title="新会话">+</button>
            <button className="text-[10px] text-slate-300 hover:text-white" onClick={refreshSessions} type="button">{isLoadingSessions ? "…" : "↻"}</button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {sessions.length === 0 ? (
            <div className="rounded border border-dashed border-slate-800 p-2 text-[10px] text-slate-500">No sessions.</div>
          ) : (
            <ul className="space-y-1">
              {sessions.map((s) => {
                const isActive = currentSessionId === s.id;
                return (
                  <li key={s.id} className="group relative">
                    <button className={`w-full rounded border px-2 py-1.5 text-left text-[11px] transition ${isActive ? "border-emerald-400/60 bg-emerald-500/10" : "border-slate-800 bg-slate-900/40 hover:border-slate-600"}`} onClick={() => switchSession(s.id)} type="button">
                      <div className="truncate pr-4 font-medium text-slate-100">{s.title?.trim() || "Untitled"}</div>
                      <div className="text-[10px] text-slate-400">{formatTimestamp(s.updatedAt)}</div>
                    </button>
                    <button
                      className="absolute right-1.5 top-1.5 rounded p-0.5 text-slate-600 opacity-0 transition hover:bg-slate-800 hover:text-rose-400 group-hover:opacity-100"
                      onClick={(e) => { e.stopPropagation(); void deleteSessionById(s.id); }}
                      type="button"
                      title="永久删除"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
                        <path fillRule="evenodd" d="M5 3.25V4H2.75a.75.75 0 0 0 0 1.5h.3l.815 8.15A1.5 1.5 0 0 0 5.357 15h5.285a1.5 1.5 0 0 0 1.493-1.35l.815-8.15h.3a.75.75 0 0 0 0-1.5H11v-.75A2.25 2.25 0 0 0 8.75 1h-1.5A2.25 2.25 0 0 0 5 3.25Zm2.25-.75a.75.75 0 0 0-.75.75V4h3v-.75a.75.75 0 0 0-.75-.75h-1.5ZM6.05 6a.75.75 0 0 1 .787.713l.275 5.5a.75.75 0 0 1-1.498.075l-.275-5.5A.75.75 0 0 1 6.05 6Zm3.9 0a.75.75 0 0 1 .712.787l-.275 5.5a.75.75 0 0 1-1.498-.075l.275-5.5A.75.75 0 0 1 9.95 6Z" clipRule="evenodd" />
                      </svg>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>

      {/* Main */}
      <section className="flex min-w-0 flex-1 flex-col">
        <AgentPanel
          key={panelKey}
          initialSessionId={currentSessionId}
          userName={userName}
          onStatusChange={() => {}}
          onSessionCreated={(sid) => setCurrentSessionId(sid)}
          onTitleChange={() => {}}
          onRefreshNeeded={handleRefresh}
        />
      </section>

      {/* Right sidebar */}
      <aside className="hidden h-full w-64 shrink-0 border-l border-slate-800 bg-slate-950/80 p-3 xl:block">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-[10px] uppercase tracking-wide text-slate-400">Resources</div>
          <button className="text-[10px] text-slate-300 hover:text-white" onClick={loadResources} type="button">{isLoadingResources ? "…" : "↻"}</button>
        </div>
        {error && <div className="mb-2 rounded border border-rose-500/40 bg-rose-500/10 px-2 py-1.5 text-[10px] text-rose-100">{error}</div>}
        {notice && <div className="mb-2 rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-1.5 text-[10px] text-emerald-100">{notice}</div>}
        <div className="flex-1 space-y-4 overflow-y-auto">
          <section>
            <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">内置 Skills</div>
            <div className="flex flex-wrap gap-1">{builtinSkills.map((s) => (<button key={s.name} className="rounded-full border border-emerald-400/60 bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-200 hover:bg-emerald-500/25" title={s.description} onClick={() => loadResourceDetail({ type: "skill", name: s.name })} type="button">{s.name}</button>))}</div>
          </section>
          <section>
            <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">内置 MCPs</div>
            <div className="flex flex-wrap gap-1">{builtinMcps.map((m) => (<button key={m.name} className={`rounded-full border px-2 py-0.5 text-[10px] ${m.active ? "border-emerald-400/60 bg-emerald-500/15 text-emerald-200" : m.available ? "border-slate-700/60 bg-slate-900/40 text-slate-400" : "border-slate-800/40 bg-slate-950/40 text-slate-600 line-through"}`} title={m.active ? `${m.name} (active)` : m.available ? `${m.name} (available)` : `${m.name} (unavailable)`} onClick={() => loadResourceDetail({ type: "mcp", name: m.name })} type="button">{m.name}</button>))}</div>
          </section>
          <hr className="border-slate-800" />
          <section>
            <div className="mb-1 text-[10px] font-semibold text-slate-100">Skills</div>
            {dbSkills.length === 0 ? <div className="text-[10px] text-slate-500">No database skills.</div> : <div className="flex flex-wrap gap-1">{dbSkills.map((s) => (<button key={s.name} className="rounded-full border border-emerald-400/60 bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-200 hover:bg-emerald-500/25" title={s.description} onClick={() => loadResourceDetail({ type: "skill", name: s.name })} type="button">{s.name}</button>))}</div>}
          </section>
          <section>
            <div className="mb-1 text-[10px] font-semibold text-slate-100">MCPs</div>
            {mcps.length === 0 ? <div className="text-[10px] text-slate-500">No MCP servers.</div> : <div className="flex flex-wrap gap-1">{mcps.map((m) => (<button key={m.name} className="rounded-full border border-slate-700 bg-slate-900/60 px-2 py-0.5 text-[10px] text-slate-300 hover:border-slate-500" title={m.description ?? ""} onClick={() => loadResourceDetail({ type: "mcp", name: m.name })} type="button">{m.name}</button>))}</div>}
          </section>
        </div>
      </aside>

      {/* Resource detail drawer */}
      {selectedResource && (
        <div className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/40 backdrop-blur-sm">
          <button className="absolute inset-0 h-full w-full cursor-pointer" onClick={() => setSelectedResource(null)} type="button" aria-label="Close" />
          <section className="relative z-10 h-full w-[90vw] max-w-[1400px] overflow-y-auto border-l border-slate-800 bg-slate-950 p-6 shadow-2xl drawer-in">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-wide text-slate-400">Detail</div>
                <div className="text-lg font-semibold text-slate-100">{selectedResource.type === "skill" ? "Skill" : "MCP"} · {selectedResource.name}</div>
              </div>
              {((selectedResource.type === "skill" && skillDetail && skillDetail.productionVersion > 0) || (selectedResource.type === "mcp" && mcpDetail && mcpDetail.productionVersion > 0)) && (
                <button className="rounded border border-rose-500/70 px-3 py-1 text-xs text-rose-100 hover:bg-rose-500/10" onClick={deleteSelectedResource} type="button" disabled={isDeletingResource}>{isDeletingResource ? "Deleting..." : "Delete"}</button>
              )}
            </div>
            {isLoadingResourceDetail ? <div className="text-sm text-slate-400">Loading…</div>
            : selectedResource.type === "skill" && skillDetail ? (
              <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
                <div className="space-y-4">
                  <div className="rounded border border-slate-800 bg-slate-900/40 p-4">
                    <div className="text-sm font-semibold text-slate-100">{skillDetail.name}</div>
                    <div className="mt-1 text-xs text-slate-400">Production v{skillDetail.productionVersion}</div>
                    {skillDetail.tags.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{skillDetail.tags.map((t) => <span key={t} className="rounded bg-slate-800 px-2 py-0.5 text-[10px] text-slate-400">{t}</span>)}</div>}
                  </div>
                  <div className="rounded border border-slate-800 bg-slate-900/40 p-4 space-y-3">
                    <label className="text-xs text-slate-400">Description</label>
                    <textarea className="h-24 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100" value={skillEdit.description} onChange={(e) => setSkillEdit((p) => ({ ...p, description: e.target.value }))} />
                    <label className="text-xs text-slate-400">Content</label>
                    <textarea className="h-64 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100" value={skillEdit.content} onChange={(e) => setSkillEdit((p) => ({ ...p, content: e.target.value }))} />
                    <label className="text-xs text-slate-400">Tags</label>
                    <input className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100" value={skillEdit.tags} onChange={(e) => setSkillEdit((p) => ({ ...p, tags: e.target.value }))} placeholder="tag-a, tag-b" />
                    <div className="flex justify-end"><button className="rounded border border-emerald-500/60 px-4 py-2 text-sm text-emerald-100 hover:bg-emerald-500/10" onClick={saveSkillVersion} type="button" disabled={isSavingResource}>{isSavingResource ? "Saving..." : "提交新版本"}</button></div>
                  </div>
                </div>
                <div className="rounded border border-slate-800 bg-slate-900/40 p-4">
                  <div className="mb-3 text-sm font-semibold text-slate-100">Versions</div>
                  {skillVersions.length === 0 ? <div className="text-xs text-slate-500">No versions.</div> : (
                    <ul className="space-y-3">{skillVersions.map((v) => (
                      <li key={v.version} className="rounded border border-slate-800 bg-slate-950/60 px-3 py-3">
                        <div className="flex items-center justify-between text-sm"><span>v{v.version}</span>{v.isProduction ? <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[11px] text-emerald-100">Production</span> : <button className="text-[11px] text-sky-300 hover:text-sky-200" onClick={() => publishSkillVersion(v.version)} type="button" disabled={isPublishingVersion}>发布</button>}</div>
                        <div className="mt-2 text-[12px] text-slate-300">{v.description}</div>
                        <div className="mt-1 text-[11px] text-slate-500">{formatTimestamp(v.createdAt)}</div>
                      </li>
                    ))}</ul>
                  )}
                </div>
              </div>
            ) : selectedResource.type === "mcp" && mcpDetail ? (
              <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
                <div className="space-y-4">
                  <div className="rounded border border-slate-800 bg-slate-900/40 p-4">
                    <div className="text-sm font-semibold text-slate-100">{mcpDetail.name}</div>
                    <div className="mt-1 text-xs text-slate-400">Production v{mcpDetail.productionVersion}</div>
                    <div className="mt-1 text-[11px] text-slate-500">{mcpDetail.enabled ? "Enabled" : "Disabled"}</div>
                  </div>
                  <div className="rounded border border-slate-800 bg-slate-900/40 p-4 space-y-3">
                    <label className="text-xs text-slate-400">Description</label>
                    <textarea className="h-24 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100" value={mcpEdit.description} onChange={(e) => setMcpEdit((p) => ({ ...p, description: e.target.value }))} />
                    <label className="text-xs text-slate-400">Code</label>
                    <textarea className="h-64 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100" value={mcpEdit.code} onChange={(e) => setMcpEdit((p) => ({ ...p, code: e.target.value }))} />
                    <div className="flex justify-end"><button className="rounded border border-sky-400/60 px-4 py-2 text-sm text-sky-100 hover:bg-sky-500/10" onClick={saveMcpVersion} type="button" disabled={isSavingResource}>{isSavingResource ? "Saving..." : "提交新版本"}</button></div>
                  </div>
                </div>
                <div className="rounded border border-slate-800 bg-slate-900/40 p-4">
                  <div className="mb-3 text-sm font-semibold text-slate-100">Versions</div>
                  {mcpVersions.length === 0 ? <div className="text-xs text-slate-500">No versions.</div> : (
                    <ul className="space-y-3">{mcpVersions.map((v) => (
                      <li key={v.version} className="rounded border border-slate-800 bg-slate-950/60 px-3 py-3">
                        <div className="flex items-center justify-between text-sm"><span>v{v.version}</span>{v.isProduction ? <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[11px] text-emerald-100">Production</span> : <button className="text-[11px] text-sky-300 hover:text-sky-200" onClick={() => publishMcpVersion(v.version)} type="button" disabled={isPublishingVersion}>发布</button>}</div>
                        <div className="mt-2 text-[12px] text-slate-300">{v.description || "No description"}</div>
                        <div className="mt-1 text-[11px] text-slate-500">{formatTimestamp(v.createdAt)}</div>
                      </li>
                    ))}</ul>
                  )}
                </div>
              </div>
            ) : <div className="text-sm text-slate-400">No detail loaded.</div>}
          </section>
        </div>
      )}
    </main>
  );
}
