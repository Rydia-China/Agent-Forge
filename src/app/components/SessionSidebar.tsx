"use client";

import { formatTimestamp } from "./client-utils";
import type { SessionSummary } from "../types";

export interface SessionSidebarProps {
  userDraft: string;
  setUserDraft: (v: string) => void;
  applyUserName: () => void;
  sessions: SessionSummary[];
  isLoadingSessions: boolean;
  refreshSessions: () => void;
  currentSessionId: string | undefined;
  switchSession: (sessionId?: string) => void;
  deleteSession: (sessionId: string) => void;
}

export function SessionSidebar({
  userDraft,
  setUserDraft,
  applyUserName,
  sessions,
  isLoadingSessions,
  refreshSessions,
  currentSessionId,
  switchSession,
  deleteSession,
}: SessionSidebarProps) {
  return (
    <aside className="flex h-full w-56 shrink-0 flex-col border-r border-slate-800 bg-slate-950/80 p-3">
      <div className="mb-3">
        <div className="text-base font-semibold">Agent Forge</div>
        <div className="text-[10px] text-slate-400">Multi-agent console</div>
      </div>
      <div className="mb-3 space-y-1">
        <label className="text-[10px] uppercase tracking-wide text-slate-400">User</label>
        <div className="flex gap-1">
          <input
            className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-100"
            value={userDraft}
            onChange={(e) => setUserDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyUserName();
              }
            }}
            placeholder="default"
          />
          <button
            className="rounded border border-slate-700 px-1.5 text-[10px] text-slate-100 hover:border-slate-500"
            onClick={applyUserName}
            type="button"
          >
            Go
          </button>
        </div>
      </div>
      <div className="mb-1.5 flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-wide text-slate-400">Sessions</div>
        <div className="flex items-center gap-1.5">
          <button
            className="text-[10px] text-slate-300 hover:text-white"
            onClick={() => switchSession(undefined)}
            type="button"
            title="新会话"
          >
            +
          </button>
          <button
            className="text-[10px] text-slate-300 hover:text-white"
            onClick={refreshSessions}
            type="button"
          >
            {isLoadingSessions ? "…" : "↻"}
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {sessions.length === 0 ? (
          <div className="rounded border border-dashed border-slate-800 p-2 text-[10px] text-slate-500">
            No sessions.
          </div>
        ) : (
          <ul className="space-y-1">
            {sessions.map((s) => {
              const isActive = currentSessionId === s.id;
              return (
                <li key={s.id} className="group relative">
                  <button
                    className={`w-full rounded border px-2 py-1.5 text-left text-[11px] transition ${isActive ? "border-emerald-400/60 bg-emerald-500/10" : "border-slate-800 bg-slate-900/40 hover:border-slate-600"}`}
                    onClick={() => switchSession(s.id)}
                    type="button"
                  >
                    <div className="truncate pr-4 font-medium text-slate-100">
                      {s.title?.trim() || "Untitled"}
                    </div>
                    <div className="text-[10px] text-slate-400">
                      {formatTimestamp(s.updatedAt)}
                    </div>
                  </button>
                  <button
                    className="absolute right-1.5 top-1.5 rounded p-0.5 text-slate-600 opacity-0 transition hover:bg-slate-800 hover:text-rose-400 group-hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      void deleteSession(s.id);
                    }}
                    type="button"
                    title="永久删除"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 16 16"
                      fill="currentColor"
                      className="h-3 w-3"
                    >
                      <path
                        fillRule="evenodd"
                        d="M5 3.25V4H2.75a.75.75 0 0 0 0 1.5h.3l.815 8.15A1.5 1.5 0 0 0 5.357 15h5.285a1.5 1.5 0 0 0 1.493-1.35l.815-8.15h.3a.75.75 0 0 0 0-1.5H11v-.75A2.25 2.25 0 0 0 8.75 1h-1.5A2.25 2.25 0 0 0 5 3.25Zm2.25-.75a.75.75 0 0 0-.75.75V4h3v-.75a.75.75 0 0 0-.75-.75h-1.5ZM6.05 6a.75.75 0 0 1 .787.713l.275 5.5a.75.75 0 0 1-1.498.075l-.275-5.5A.75.75 0 0 1 6.05 6Zm3.9 0a.75.75 0 0 1 .712.787l-.275 5.5a.75.75 0 0 1-1.498-.075l.275-5.5A.75.75 0 0 1 9.95 6Z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
