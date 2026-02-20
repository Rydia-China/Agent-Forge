"use client";

import type { UseResourceDetailReturn } from "./hooks/useResourceDetail";
import { SkillEditor } from "./SkillEditor";
import { McpEditor } from "./McpEditor";

export interface ResourceDetailDrawerProps {
  detail: UseResourceDetailReturn;
}

export function ResourceDetailDrawer({ detail }: ResourceDetailDrawerProps) {
  if (!detail.selectedResource) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/40 backdrop-blur-sm">
      <button
        className="absolute inset-0 h-full w-full cursor-pointer"
        onClick={() => detail.setSelectedResource(null)}
        type="button"
        aria-label="Close"
      />
      <section className="relative z-10 h-full w-[90vw] max-w-[1400px] overflow-y-auto border-l border-slate-800 bg-slate-950 p-6 shadow-2xl drawer-in">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-400">Detail</div>
            <div className="text-lg font-semibold text-slate-100">
              {detail.selectedResource.type === "skill" ? "Skill" : "MCP"} ·{" "}
              {detail.selectedResource.name}
            </div>
          </div>
          {((detail.selectedResource.type === "skill" &&
            detail.skillDetail &&
            detail.skillDetail.productionVersion > 0) ||
            (detail.selectedResource.type === "mcp" &&
              detail.mcpDetail &&
              detail.mcpDetail.productionVersion > 0)) && (
            <button
              className="rounded border border-rose-500/70 px-3 py-1 text-xs text-rose-100 hover:bg-rose-500/10"
              onClick={() => void detail.deleteSelectedResource()}
              type="button"
              disabled={detail.isDeletingResource}
            >
              {detail.isDeletingResource ? "Deleting..." : "Delete"}
            </button>
          )}
        </div>

        {detail.error && (
          <div className="mb-3 rounded border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
            {detail.error}
          </div>
        )}
        {detail.notice && (
          <div className="mb-3 rounded border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
            {detail.notice}
          </div>
        )}

        {detail.isLoadingResourceDetail ? (
          <div className="text-sm text-slate-400">Loading…</div>
        ) : detail.selectedResource.type === "skill" && detail.skillDetail ? (
          <SkillEditor
            detail={detail.skillDetail}
            versions={detail.skillVersions}
            edit={detail.skillEdit}
            setEdit={detail.setSkillEdit}
            isSaving={detail.isSavingResource}
            isPublishing={detail.isPublishingVersion}
            onSave={() => void detail.saveSkillVersion()}
            onPublish={(v) => void detail.publishSkillVersion(v)}
          />
        ) : detail.selectedResource.type === "mcp" && detail.mcpDetail ? (
          <McpEditor
            detail={detail.mcpDetail}
            versions={detail.mcpVersions}
            edit={detail.mcpEdit}
            setEdit={detail.setMcpEdit}
            isSaving={detail.isSavingResource}
            isPublishing={detail.isPublishingVersion}
            onSave={() => void detail.saveMcpVersion()}
            onPublish={(v) => void detail.publishMcpVersion(v)}
          />
        ) : (
          <div className="text-sm text-slate-400">No detail loaded.</div>
        )}
      </section>
    </div>
  );
}
