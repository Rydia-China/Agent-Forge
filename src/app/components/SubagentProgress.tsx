"use client";

import {
  LoadingOutlined,
  CheckCircleFilled,
  CloseCircleFilled,
  ToolOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import type { SubagentTaskInfo } from "./hooks/useTaskStream";

/** Shorten model name for display: "google/gemini-3.1-pro-preview" → "gemini-3.1-pro" */
function shortModel(model: string): string {
  const name = model.includes("/") ? model.split("/").pop()! : model;
  return name.replace(/-preview$/, "");
}

/** Shorten tool name: "video_workflow__generate_portrait" → "generate_portrait" */
function shortTool(tool: string): string {
  const idx = tool.indexOf("__");
  return idx >= 0 ? tool.slice(idx + 2) : tool;
}

function isOk(status: SubagentTaskInfo["status"]): boolean {
  return status === "ok" || status === "completed";
}

function StatusIcon({ status }: { status: SubagentTaskInfo["status"] }) {
  switch (status) {
    case "running":
      return <LoadingOutlined className="text-blue-400" style={{ fontSize: 28 }} spin />;
    case "ok":
    case "completed":
      return <CheckCircleFilled className="text-emerald-400" style={{ fontSize: 28 }} />;
    case "max_iterations":
      return <WarningOutlined className="text-amber-400" style={{ fontSize: 28 }} />;
    default:
      return <CloseCircleFilled className="text-red-400" style={{ fontSize: 28 }} />;
  }
}

function TaskCard({ task }: { task: SubagentTaskInfo }) {
  const isRunning = task.status === "running";
  const ok = isOk(task.status);
  const isToolLoop = task.mode === "tool-loop" || task.mode === "continue";

  return (
    <div
      className={`
        flex min-w-[130px] max-w-[220px] flex-col gap-1 rounded-md border px-2.5 py-2 text-sm
        transition-all duration-300
        ${isRunning
          ? isToolLoop
            ? "border-violet-500/50 bg-violet-500/10"
            : "animate-pulse border-blue-500/50 bg-blue-500/10"
          : ok
            ? "border-emerald-500/40 bg-emerald-500/10"
            : task.status === "max_iterations"
              ? "border-amber-500/40 bg-amber-500/10"
              : "border-red-500/40 bg-red-500/10"
        }
      `}
    >
      {/* Header: status + mode badge */}
      <div className="flex items-center gap-1.5">
        <StatusIcon status={task.status} />
        {isToolLoop && (
          <span className="rounded bg-violet-500/20 px-1 text-sm text-violet-300">
            {task.mode === "continue" ? "cont" : "loop"}
          </span>
        )}
      </div>

      {/* Instruction preview */}
      <div className="truncate text-slate-400" title={task.instruction}>
        {task.instruction || "…"}
      </div>

      {/* Current tool (tool-loop only, animated when running) */}
      {task.currentTool && (
        <div className="flex items-center gap-1 text-blue-300">
          <ToolOutlined className="animate-pulse" style={{ fontSize: 28 }} />
          <span className="truncate">{shortTool(task.currentTool)}</span>
        </div>
      )}

      {/* Stats line */}
      <div className="flex items-center gap-2 text-sm text-slate-500">
        {task.toolCallCount > 0 && (
          <span>{task.toolCallCount} tool{task.toolCallCount > 1 ? "s" : ""}</span>
        )}
        {task.durationMs != null && (
          <span>{(task.durationMs / 1000).toFixed(1)}s</span>
        )}
        {isRunning && task.toolCallCount === 0 && !task.currentTool && (
          <span className="animate-pulse">{isToolLoop ? "initializing…" : "thinking…"}</span>
        )}
      </div>
    </div>
  );
}

export interface SubagentProgressProps {
  tasks: SubagentTaskInfo[];
}

export function SubagentProgress({ tasks }: SubagentProgressProps) {
  if (tasks.length === 0) return null;

  const done = tasks.filter((t) => t.status !== "running").length;
  const allDone = done === tasks.length;

  return (
    <div className="mt-2 rounded-md border border-slate-800 bg-slate-950/80 p-2.5">
      <div className="mb-2 flex items-center gap-2 text-sm text-slate-400">
        <LoadingOutlined
          className={allDone ? "text-emerald-400" : "text-blue-400"}
          style={{ fontSize: 28 }}
          spin={!allDone}
        />
        <span>
          {allDone
            ? `SubAgent ${done}/${tasks.length} done`
            : `SubAgent ${done}/${tasks.length}`
          }
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {tasks.map((task) => (
          <TaskCard key={task.index} task={task} />
        ))}
      </div>
    </div>
  );
}
