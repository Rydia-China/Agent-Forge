"use client";

import {
  LoadingOutlined,
  CheckCircleFilled,
  CloseCircleFilled,
  ToolOutlined,
} from "@ant-design/icons";
import type { ActiveToolInfo } from "./hooks/useTaskStream";

/** Shorten tool name: "video_workflow__generate_portrait" → "generate_portrait" */
function shortTool(tool: string): string {
  const idx = tool.indexOf("__");
  return idx >= 0 ? tool.slice(idx + 2) : tool;
}

function StatusIcon({ status }: { status: ActiveToolInfo["status"] }) {
  switch (status) {
    case "running":
      return <LoadingOutlined className="text-blue-400" style={{ fontSize: 16 }} spin />;
    case "done":
      return <CheckCircleFilled className="text-emerald-400" style={{ fontSize: 16 }} />;
    default:
      return <CloseCircleFilled className="text-red-400" style={{ fontSize: 16 }} />;
  }
}

function ToolCard({ tool }: { tool: ActiveToolInfo }) {
  const isRunning = tool.status === "running";

  return (
    <div
      className={`
        flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm
        transition-all duration-300
        ${isRunning
          ? "animate-pulse border-blue-500/50 bg-blue-500/10"
          : tool.status === "done"
            ? "border-emerald-500/40 bg-emerald-500/10"
            : "border-red-500/40 bg-red-500/10"
        }
      `}
    >
      <StatusIcon status={tool.status} />
      <ToolOutlined className="text-slate-400" style={{ fontSize: 14 }} />
      <span className="truncate text-slate-200">{shortTool(tool.name)}</span>
      {tool.total > 1 && (
        <span className="shrink-0 text-slate-500">
          {tool.index + 1}/{tool.total}
        </span>
      )}
      {tool.durationMs != null && (
        <span className="shrink-0 text-slate-500">
          {(tool.durationMs / 1000).toFixed(1)}s
        </span>
      )}
    </div>
  );
}

export interface ToolProgressProps {
  tools: ActiveToolInfo[];
}

export function ToolProgress({ tools }: ToolProgressProps) {
  if (tools.length === 0) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {tools.map((tool) => (
        <ToolCard key={tool.callId} tool={tool} />
      ))}
    </div>
  );
}
