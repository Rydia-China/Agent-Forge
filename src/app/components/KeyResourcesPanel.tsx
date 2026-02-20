"use client";

import type { KeyResourceItem } from "../types";
import { JsonViewer } from "./JsonViewer";

export interface KeyResourcesPanelProps {
  keyResources: KeyResourceItem[];
  onImageClick: (url: string) => void;
}

export function KeyResourcesPanel({
  keyResources,
  onImageClick,
}: KeyResourcesPanelProps) {
  return (
    <aside className="flex w-72 shrink-0 flex-col border-l border-slate-800 bg-slate-950/80">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-800 bg-slate-950/90 px-3 py-2 backdrop-blur">
        <span className="text-[10px] uppercase tracking-wide text-slate-400">
          关键资源
        </span>
        <span className="text-[10px] text-slate-500">{keyResources.length}</span>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {keyResources.map((kr) => (
          <div
            key={kr.id}
            className="rounded border border-slate-800 bg-slate-900/40 p-2 fade-in"
          >
            {kr.title && (
              <div className="mb-1.5 text-[10px] font-medium text-slate-300">
                {kr.title}
              </div>
            )}
            {kr.mediaType === "image" && kr.url && (
              <button
                type="button"
                className="block w-full"
                onClick={() => onImageClick(kr.url!)}
              >
                <img
                  src={kr.url}
                  alt={kr.title ?? "Image"}
                  className="w-full cursor-zoom-in rounded border border-slate-700 object-cover transition hover:border-slate-500"
                />
              </button>
            )}
            {kr.mediaType === "video" && kr.url && (
              <video
                src={kr.url}
                controls
                className="w-full rounded border border-slate-700"
              />
            )}
            {kr.mediaType === "json" && kr.data != null && (
              <JsonViewer data={kr.data} />
            )}
            {!kr.url && kr.mediaType !== "json" && (
              <div className="text-[10px] text-slate-500">No content</div>
            )}
          </div>
        ))}
      </div>
    </aside>
  );
}
