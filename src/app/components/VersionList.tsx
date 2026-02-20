"use client";

import { formatTimestamp } from "./client-utils";

export interface VersionItem {
  version: number;
  description: string | null;
  isProduction: boolean;
  createdAt: string;
}

export interface VersionListProps {
  versions: VersionItem[];
  isPublishing: boolean;
  onPublish: (version: number) => void;
}

export function VersionList({ versions, isPublishing, onPublish }: VersionListProps) {
  if (versions.length === 0) {
    return <div className="text-xs text-slate-500">No versions.</div>;
  }
  return (
    <ul className="space-y-3">
      {versions.map((v) => (
        <li
          key={v.version}
          className="rounded border border-slate-800 bg-slate-950/60 px-3 py-3"
        >
          <div className="flex items-center justify-between text-sm">
            <span>v{v.version}</span>
            {v.isProduction ? (
              <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[11px] text-emerald-100">
                Production
              </span>
            ) : (
              <button
                className="text-[11px] text-sky-300 hover:text-sky-200"
                onClick={() => onPublish(v.version)}
                type="button"
                disabled={isPublishing}
              >
                发布
              </button>
            )}
          </div>
          <div className="mt-2 text-[12px] text-slate-300">
            {v.description || "No description"}
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            {formatTimestamp(v.createdAt)}
          </div>
        </li>
      ))}
    </ul>
  );
}
