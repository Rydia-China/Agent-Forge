"use client";

import { useState } from "react";
import { Button } from "antd";
import { ExpandOutlined, CompressOutlined } from "@ant-design/icons";

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
        <Button
          type="link"
          size="small"
          icon={expanded ? <CompressOutlined /> : <ExpandOutlined />}
          onClick={() => setExpanded((v) => !v)}
          style={{ fontSize: 10, padding: 0, marginTop: 4 }}
        >
          {expanded ? "收起" : "展开全部"}
        </Button>
      )}
    </div>
  );
}
