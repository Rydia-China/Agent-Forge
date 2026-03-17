"use client";

import { LoadingOutlined, CheckCircleFilled, CloseCircleFilled } from "@ant-design/icons";
import type { SubagentTaskInfo } from "./hooks/useTaskStream";

/** Shorten model name for display: "google/gemini-3.1-pro-preview" → "gemini-3.1-pro" */
function shortModel(model: string): string {
  const name = model.includes("/") ? model.split("/").pop()! : model;
  return name.replace(/-preview$/, "");
}

function TaskCard({ task }: { task: SubagentTaskInfo }) {
  const isRunning = task.status === "running";
  const isOk = task.status === "ok";

  return (
    <div
      className={`
        flex min-w-[120px] max-w-[200px] flex-col gap-1 rounded-md border px-2.5 py-2 text-[10px]
        transition-all duration-300
        ${isRunning
          ? "animate-pulse border-blue-500/50 bg-blue-500/10"
          : isOk
            ? "border-emerald-500/40 bg-emerald-500/10"
            : "border-red-500/40 bg-red-500/10"
        }
      `}
    >
      {/* Status row */}
      <div className="flex items-center gap-1.5">
        {isRunning ? (
          <LoadingOutlined className="text-blue-400" style={{ fontSize: 11 }} spin />
        ) : isOk ? (
          <CheckCircleFilled className="text-emerald-400" style={{ fontSize: 11 }} />
        ) : (
          <CloseCircleFilled className="text-red-400" style={{ fontSize: 11 }} />
        )}
        <span className="truncate font-medium text-slate-200">
          {shortModel(task.model)}
        </span>
      </div>

      {/* Prompt preview */}
      <div className="truncate text-slate-400" title={task.promptPreview}>
        {task.promptPreview || "…"}
      </div>

      {/* Duration */}
      {task.durationMs != null && (
        <div className="text-[9px] text-slate-500">
          {(task.durationMs / 1000).toFixed(1)}s
        </div>
      )}
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
      <div className="mb-2 flex items-center gap-2 text-[10px] text-slate-400">
        <LoadingOutlined
          className={allDone ? "text-emerald-400" : "text-blue-400"}
          style={{ fontSize: 10 }}
          spin={!allDone}
        />
        <span>
          {allDone
            ? `Subagent ${done}/${tasks.length} done — processing results…`
            : `Subagent ${done}/${tasks.length}`
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
