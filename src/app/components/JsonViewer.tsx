"use client";

import { useState } from "react";

export function JsonViewer({ data }: { data: unknown }) {
  const [expanded, setExpanded] = useState(false);
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  const preview = text.length > 200 ? text.slice(0, 200) + "\u2026" : text;
  return (
    <div className="rounded border border-slate-800 bg-slate-950/80 p-2">
      <pre className="whitespace-pre-wrap break-all font-mono text-[10px] leading-relaxed text-slate-300">
        {expanded ? text : preview}
      </pre>
      {text.length > 200 && (
        <button
          className="mt-1 text-[10px] text-sky-400 hover:text-sky-300"
          onClick={() => setExpanded((v) => !v)}
          type="button"
        >
          {expanded ? "收起" : "展开全部"}
        </button>
      )}
    </div>
  );
}
