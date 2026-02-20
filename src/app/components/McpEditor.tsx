"use client";

import type { McpDetail, McpVersionSummary } from "../types";
import { VersionList } from "./VersionList";

export interface McpEditorProps {
  detail: McpDetail;
  versions: McpVersionSummary[];
  edit: { description: string; code: string };
  setEdit: React.Dispatch<React.SetStateAction<{ description: string; code: string }>>;
  isSaving: boolean;
  isPublishing: boolean;
  onSave: () => void;
  onPublish: (version: number) => void;
}

export function McpEditor({
  detail,
  versions,
  edit,
  setEdit,
  isSaving,
  isPublishing,
  onSave,
  onPublish,
}: McpEditorProps) {
  return (
    <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
      <div className="space-y-4">
        <div className="rounded border border-slate-800 bg-slate-900/40 p-4">
          <div className="text-sm font-semibold text-slate-100">{detail.name}</div>
          <div className="mt-1 text-xs text-slate-400">Production v{detail.productionVersion}</div>
          <div className="mt-1 text-[11px] text-slate-500">
            {detail.enabled ? "Enabled" : "Disabled"}
          </div>
        </div>
        <div className="rounded border border-slate-800 bg-slate-900/40 p-4 space-y-3">
          <label className="text-xs text-slate-400">Description</label>
          <textarea
            className="h-24 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
            value={edit.description}
            onChange={(e) => setEdit((p) => ({ ...p, description: e.target.value }))}
          />
          <label className="text-xs text-slate-400">Code</label>
          <textarea
            className="h-64 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
            value={edit.code}
            onChange={(e) => setEdit((p) => ({ ...p, code: e.target.value }))}
          />
          <div className="flex justify-end">
            <button
              className="rounded border border-sky-400/60 px-4 py-2 text-sm text-sky-100 hover:bg-sky-500/10"
              onClick={onSave}
              type="button"
              disabled={isSaving}
            >
              {isSaving ? "Saving..." : "提交新版本"}
            </button>
          </div>
        </div>
      </div>
      <div className="rounded border border-slate-800 bg-slate-900/40 p-4">
        <div className="mb-3 text-sm font-semibold text-slate-100">Versions</div>
        <VersionList versions={versions} isPublishing={isPublishing} onPublish={onPublish} />
      </div>
    </div>
  );
}
