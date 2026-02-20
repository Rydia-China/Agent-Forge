"use client";

import type { SkillDetail, SkillVersionSummary } from "../types";
import { VersionList } from "./VersionList";

export interface SkillEditorProps {
  detail: SkillDetail;
  versions: SkillVersionSummary[];
  edit: { description: string; content: string; tags: string };
  setEdit: React.Dispatch<React.SetStateAction<{ description: string; content: string; tags: string }>>;
  isSaving: boolean;
  isPublishing: boolean;
  onSave: () => void;
  onPublish: (version: number) => void;
}

export function SkillEditor({
  detail,
  versions,
  edit,
  setEdit,
  isSaving,
  isPublishing,
  onSave,
  onPublish,
}: SkillEditorProps) {
  return (
    <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
      <div className="space-y-4">
        <div className="rounded border border-slate-800 bg-slate-900/40 p-4">
          <div className="text-sm font-semibold text-slate-100">{detail.name}</div>
          <div className="mt-1 text-xs text-slate-400">Production v{detail.productionVersion}</div>
          {detail.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {detail.tags.map((t) => (
                <span key={t} className="rounded bg-slate-800 px-2 py-0.5 text-[10px] text-slate-400">
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="rounded border border-slate-800 bg-slate-900/40 p-4 space-y-3">
          <label className="text-xs text-slate-400">Description</label>
          <textarea
            className="h-24 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
            value={edit.description}
            onChange={(e) => setEdit((p) => ({ ...p, description: e.target.value }))}
          />
          <label className="text-xs text-slate-400">Content</label>
          <textarea
            className="h-64 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
            value={edit.content}
            onChange={(e) => setEdit((p) => ({ ...p, content: e.target.value }))}
          />
          <label className="text-xs text-slate-400">Tags</label>
          <input
            className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
            value={edit.tags}
            onChange={(e) => setEdit((p) => ({ ...p, tags: e.target.value }))}
            placeholder="tag-a, tag-b"
          />
          <div className="flex justify-end">
            <button
              className="rounded border border-emerald-500/60 px-4 py-2 text-sm text-emerald-100 hover:bg-emerald-500/10"
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
