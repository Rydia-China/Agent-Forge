"use client";

import { useEffect, useState } from "react";
import {
  LoadingOutlined,
  CheckCircleFilled,
  CloseCircleFilled,
  ToolOutlined,
  WarningOutlined,
  BranchesOutlined,
} from "@ant-design/icons";
import type { ActiveToolInfo, SubagentTaskInfo } from "./hooks/useTaskStream";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function shortTool(tool: string): string {
  const idx = tool.indexOf("__");
  return idx >= 0 ? tool.slice(idx + 2) : tool;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function isSubagentTool(name: string): boolean {
  return name.startsWith("subagent__");
}

/* ------------------------------------------------------------------ */
/*  Live elapsed timer hook                                            */
/* ------------------------------------------------------------------ */

function useElapsed(hasRunning: boolean): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!hasRunning) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [hasRunning]);
  return tick;
}

/* ------------------------------------------------------------------ */
/*  Status icons                                                       */
/* ------------------------------------------------------------------ */

function ToolStatusIcon({ status, size = 14 }: { status: "running" | "done" | "error"; size?: number }) {
  switch (status) {
    case "running":
      return <LoadingOutlined className="text-blue-400" style={{ fontSize: size }} spin />;
    case "done":
      return <CheckCircleFilled className="text-emerald-400" style={{ fontSize: size }} />;
    default:
      return <CloseCircleFilled className="text-red-400" style={{ fontSize: size }} />;
  }
}

type SubagentStatus = SubagentTaskInfo["status"];

function SubagentStatusIcon({ status, size = 14 }: { status: SubagentStatus; size?: number }) {
  switch (status) {
    case "running":
      return <LoadingOutlined className="text-violet-400" style={{ fontSize: size }} spin />;
    case "ok":
    case "completed":
      return <CheckCircleFilled className="text-emerald-400" style={{ fontSize: size }} />;
    case "max_iterations":
      return <WarningOutlined className="text-amber-400" style={{ fontSize: size }} />;
    default:
      return <CloseCircleFilled className="text-red-400" style={{ fontSize: size }} />;
  }
}

/* ------------------------------------------------------------------ */
/*  Subagent task row (nested inside a tool)                           */
/* ------------------------------------------------------------------ */

function SubagentRow({ task }: { task: SubagentTaskInfo }) {
  const isRunning = task.status === "running";
  const isToolLoop = task.mode === "tool-loop" || task.mode === "continue";

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1.5 text-sm">
        <SubagentStatusIcon status={task.status} />
        {isToolLoop && (
          <span className="rounded bg-violet-500/20 px-1 text-xs text-violet-300">
            {task.mode === "continue" ? "cont" : "loop"}
          </span>
        )}
        <span className="truncate text-slate-300" title={task.instruction}>
          {task.instruction || "…"}
        </span>
        {/* Stats */}
        {task.toolCallCount > 0 && (
          <span className="shrink-0 text-slate-500">{task.toolCallCount}t</span>
        )}
        {task.durationMs != null && (
          <span className="shrink-0 text-slate-500">{formatDuration(task.durationMs)}</span>
        )}
        {isRunning && task.toolCallCount === 0 && !task.currentTool && (
          <span className="animate-pulse text-slate-500">
            {isToolLoop ? "init…" : "thinking…"}
          </span>
        )}
      </div>
      {/* Current internal tool call — the "stuck here" indicator */}
      {task.currentTool && (
        <div className="ml-4 flex items-center gap-1 text-sm">
          <span className="text-slate-600">└</span>
          <ToolOutlined className="animate-pulse text-blue-400" style={{ fontSize: 12 }} />
          <span className="truncate text-blue-300">{shortTool(task.currentTool)}</span>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tool row (top-level controller tool call)                          */
/* ------------------------------------------------------------------ */

function ToolRow({
  tool,
  isLast,
  subagentTasks,
}: {
  tool: ActiveToolInfo;
  isLast: boolean;
  subagentTasks: SubagentTaskInfo[] | null;
}) {
  const isRunning = tool.status === "running";
  const elapsed = isRunning ? Date.now() - tool.startedAt : undefined;
  const isSub = isSubagentTool(tool.name);
  const connector = isLast ? "└" : "├";

  return (
    <div className="flex flex-col">
      {/* Tool call line */}
      <div className="flex items-center gap-1.5 text-sm">
        <span className="w-3 text-center text-slate-600">{connector}</span>
        <ToolStatusIcon status={tool.status} />
        <ToolOutlined className="text-slate-500" style={{ fontSize: 12 }} />
        <span className={`truncate ${isRunning ? "font-medium text-slate-100" : "text-slate-300"}`}>
          {shortTool(tool.name)}
        </span>
        {tool.total > 1 && (
          <span className="shrink-0 text-slate-500 text-xs">
            {tool.index + 1}/{tool.total}
          </span>
        )}
        {/* Duration: completed = exact, running = live elapsed */}
        {tool.durationMs != null ? (
          <span className="shrink-0 text-slate-500">{formatDuration(tool.durationMs)}</span>
        ) : elapsed != null && elapsed >= 1000 ? (
          <span className="shrink-0 text-blue-400/70">{formatDuration(elapsed)}</span>
        ) : null}
        {tool.error && (
          <span className="truncate text-red-400 text-xs">{tool.error}</span>
        )}
      </div>

      {/* Nested subagent tasks */}
      {isSub && subagentTasks && subagentTasks.length > 0 && (
        <div className={`ml-3 mt-0.5 flex flex-col gap-1 border-l border-slate-700/50 pl-3`}>
          {subagentTasks.map((task) => (
            <SubagentRow key={task.index} task={task} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export interface ExecutionProgressProps {
  tools: ActiveToolInfo[];
  subagentTasks: SubagentTaskInfo[];
}

export function ExecutionProgress({ tools, subagentTasks }: ExecutionProgressProps) {
  if (tools.length === 0 && subagentTasks.length === 0) return null;

  const hasRunning =
    tools.some((t) => t.status === "running") ||
    subagentTasks.some((t) => t.status === "running");

  // Tick to update live elapsed timers
  useElapsed(hasRunning);

  // Find the last subagent tool to attach subagentTasks to
  let subagentToolIdx = -1;
  for (let i = tools.length - 1; i >= 0; i--) {
    if (isSubagentTool(tools[i]!.name)) {
      subagentToolIdx = i;
      break;
    }
  }

  // If subagent tasks exist but no matching tool yet (race), show them standalone
  const orphanSubagentTasks = subagentToolIdx === -1 && subagentTasks.length > 0;

  return (
    <div className="mt-2 rounded-md border border-slate-800 bg-slate-950/80 px-2.5 py-2">
      {/* Header */}
      <div className="mb-1.5 flex items-center gap-1.5 text-xs text-slate-500">
        <BranchesOutlined style={{ fontSize: 12 }} />
        <span>
          {tools.length} tool{tools.length !== 1 ? "s" : ""}
          {subagentTasks.length > 0 &&
            ` · ${subagentTasks.filter((t) => t.status !== "running").length}/${subagentTasks.length} agents`}
        </span>
      </div>

      {/* Tree */}
      <div className="flex flex-col gap-0.5">
        {tools.map((tool, i) => (
          <ToolRow
            key={tool.callId}
            tool={tool}
            isLast={i === tools.length - 1 && !orphanSubagentTasks}
            subagentTasks={i === subagentToolIdx ? subagentTasks : null}
          />
        ))}

        {/* Orphan subagent tasks (no matching tool yet) */}
        {orphanSubagentTasks && (
          <div className="flex flex-col">
            <div className="flex items-center gap-1.5 text-sm">
              <span className="w-3 text-center text-slate-600">└</span>
              <LoadingOutlined className="text-violet-400" style={{ fontSize: 14 }} spin />
              <span className="text-slate-300">subagent</span>
            </div>
            <div className="ml-3 mt-0.5 flex flex-col gap-1 border-l border-slate-700/50 pl-3">
              {subagentTasks.map((task) => (
                <SubagentRow key={task.index} task={task} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
