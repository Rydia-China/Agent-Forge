"use client";

import type {
  SkillSummary,
  McpSummary,
  BuiltinMcpSummary,
  ResourceSelection,
} from "../types";

export interface ResourceDrawerProps {
  builtinSkills: SkillSummary[];
  dbSkills: SkillSummary[];
  builtinMcps: BuiltinMcpSummary[];
  mcps: McpSummary[];
  isLoadingResources: boolean;
  error: string | null;
  notice: string | null;
  onLoadResources: () => void;
  onSelectResource: (resource: ResourceSelection) => void;
  onClose: () => void;
}

export function ResourceDrawer({
  builtinSkills,
  dbSkills,
  builtinMcps,
  mcps,
  isLoadingResources,
  error,
  notice,
  onLoadResources,
  onSelectResource,
  onClose,
}: ResourceDrawerProps) {
  return (
    <div className="fixed inset-0 z-40 flex items-stretch justify-end bg-black/40 backdrop-blur-sm">
      <button
        className="absolute inset-0 h-full w-full cursor-pointer"
        onClick={onClose}
        type="button"
        aria-label="Close"
      />
      <aside className="relative z-10 h-full w-72 overflow-y-auto border-l border-slate-800 bg-slate-950 p-4 shadow-2xl drawer-in">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-[10px] uppercase tracking-wide text-slate-400">Resources</div>
          <div className="flex items-center gap-2">
            <button
              className="text-[10px] text-slate-300 hover:text-white"
              onClick={onLoadResources}
              type="button"
            >
              {isLoadingResources ? "…" : "↻"}
            </button>
            <button
              className="text-[10px] text-slate-400 hover:text-white"
              onClick={onClose}
              type="button"
            >
              ✕
            </button>
          </div>
        </div>
        {error && (
          <div className="mb-2 rounded border border-rose-500/40 bg-rose-500/10 px-2 py-1.5 text-[10px] text-rose-100">
            {error}
          </div>
        )}
        {notice && (
          <div className="mb-2 rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-1.5 text-[10px] text-emerald-100">
            {notice}
          </div>
        )}
        <div className="space-y-4">
          <section>
            <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">
              内置 Skills
            </div>
            <div className="flex flex-wrap gap-1">
              {builtinSkills.map((s) => (
                <button
                  key={s.name}
                  className="rounded-full border border-emerald-400/60 bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-200 hover:bg-emerald-500/25"
                  title={s.description}
                  onClick={() => {
                    onSelectResource({ type: "skill", name: s.name });
                    onClose();
                  }}
                  type="button"
                >
                  {s.name}
                </button>
              ))}
            </div>
          </section>
          <section>
            <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">
              内置 MCPs
            </div>
            <div className="flex flex-wrap gap-1">
              {builtinMcps.map((m) => (
                <button
                  key={m.name}
                  className={`rounded-full border px-2 py-0.5 text-[10px] ${m.active ? "border-emerald-400/60 bg-emerald-500/15 text-emerald-200" : m.available ? "border-slate-700/60 bg-slate-900/40 text-slate-400" : "border-slate-800/40 bg-slate-950/40 text-slate-600 line-through"}`}
                  title={
                    m.active
                      ? `${m.name} (active)`
                      : m.available
                        ? `${m.name} (available)`
                        : `${m.name} (unavailable)`
                  }
                  onClick={() => {
                    onSelectResource({ type: "mcp", name: m.name });
                    onClose();
                  }}
                  type="button"
                >
                  {m.name}
                </button>
              ))}
            </div>
          </section>
          <hr className="border-slate-800" />
          <section>
            <div className="mb-1 text-[10px] font-semibold text-slate-100">Skills</div>
            {dbSkills.length === 0 ? (
              <div className="text-[10px] text-slate-500">No database skills.</div>
            ) : (
              <div className="flex flex-wrap gap-1">
                {dbSkills.map((s) => (
                  <button
                    key={s.name}
                    className="rounded-full border border-emerald-400/60 bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-200 hover:bg-emerald-500/25"
                    title={s.description}
                    onClick={() => {
                      onSelectResource({ type: "skill", name: s.name });
                      onClose();
                    }}
                    type="button"
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            )}
          </section>
          <section>
            <div className="mb-1 text-[10px] font-semibold text-slate-100">MCPs</div>
            {mcps.length === 0 ? (
              <div className="text-[10px] text-slate-500">No MCP servers.</div>
            ) : (
              <div className="flex flex-wrap gap-1">
                {mcps.map((m) => (
                  <button
                    key={m.name}
                    className="rounded-full border border-slate-700 bg-slate-900/60 px-2 py-0.5 text-[10px] text-slate-300 hover:border-slate-500"
                    title={m.description ?? ""}
                    onClick={() => {
                      onSelectResource({ type: "mcp", name: m.name });
                      onClose();
                    }}
                    type="button"
                  >
                    {m.name}
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>
      </aside>
    </div>
  );
}
