"use client";

import { useState } from "react";
import { Badge, Button, Empty, Tag, Tooltip } from "antd";
import {
  LoadingOutlined,
  CloseOutlined,
  ExclamationCircleFilled,
  CheckCircleFilled,
  ClockCircleOutlined,
  ArrowRightOutlined,
  StopOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { fetchJson } from "@/app/components/client-utils";
import type { UseTaskMonitorReturn, NovelTaskInfo, TaskBadgeStatus } from "../hooks/useTaskMonitor";

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

export interface TaskMonitorProps {
  monitor: UseTaskMonitorReturn;
  /** Jump to a specific EP + session. */
  onJumpToTask: (scriptKey: string | null, sessionId: string) => void;
  /** Retry a failed task — creates a new task in the same session context. */
  onRetryTask?: (task: NovelTaskInfo) => void;
}

/* ------------------------------------------------------------------ */
/*  Status helpers                                                     */
/* ------------------------------------------------------------------ */

function statusIcon(status: string) {
  switch (status) {
    case "running":
      return <LoadingOutlined className="text-blue-400" spin style={{ fontSize: 28 }} />;
    case "pending":
      return <ClockCircleOutlined className="text-slate-400" style={{ fontSize: 28 }} />;
    case "completed":
      return <CheckCircleFilled className="text-emerald-400" style={{ fontSize: 28 }} />;
    case "failed":
      return <ExclamationCircleFilled className="text-red-400" style={{ fontSize: 28 }} />;
    case "cancelled":
      return <CloseOutlined className="text-slate-500" style={{ fontSize: 28 }} />;
    default:
      return null;
  }
}

function statusColor(status: string): string {
  switch (status) {
    case "running": return "blue";
    case "pending": return "default";
    case "completed": return "green";
    case "failed": return "red";
    case "cancelled": return "default";
    default: return "default";
  }
}

function elapsed(from: string): string {
  const ms = Date.now() - new Date(from).getTime();
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600_000) return `${Math.round(ms / 60_000)}m`;
  return `${(ms / 3600_000).toFixed(1)}h`;
}

function badgeColor(status: TaskBadgeStatus): string {
  switch (status) {
    case "failed": return "#ff4d4f";
    case "running": return "#1677ff";
    case "queued": return "#8c8c8c";
    default: return "#52c41a";
  }
}

/* ------------------------------------------------------------------ */
/*  Task card                                                          */
/* ------------------------------------------------------------------ */

function TaskCard({
  task,
  onJump,
  onCancel,
  onMarkRead,
}: {
  task: NovelTaskInfo;
  onJump: () => void;
  onCancel?: () => void;
  onMarkRead?: () => void;
}) {
  const isActive = task.status === "running" || task.status === "pending";
  const isFailed = task.status === "failed";

  return (
    <div
      className={`rounded border px-2.5 py-2 text-sm transition ${
        isFailed
          ? "border-red-500/40 bg-red-500/5"
          : isActive
            ? "border-blue-500/30 bg-blue-500/5"
            : "border-slate-800 bg-slate-900/40"
      }`}
    >
      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-1.5 min-w-0">
          {statusIcon(task.status)}
          <span className="font-medium text-slate-200 truncate">
            {task.scriptKey ?? "Novel"}
          </span>
          <Tag
            color={statusColor(task.status)}
            style={{ fontSize: 14, lineHeight: "22px", margin: 0, padding: "0 6px" }}
          >
            {task.status}
          </Tag>
        </div>
        <span className="shrink-0 text-sm text-slate-500">
          {elapsed(isActive ? task.createdAt : task.updatedAt)}
        </span>
      </div>

      {task.sessionTitle && (
        <div className="mt-0.5 truncate text-sm text-slate-500">
          {task.sessionTitle}
        </div>
      )}

      {isFailed && task.error && (
        <div className="mt-1 truncate text-sm text-red-400">
          {task.error}
        </div>
      )}

      <div className="mt-1.5 flex items-center gap-1">
        <Button
          type="link"
          size="small"
          icon={<ArrowRightOutlined />}
          onClick={() => {
            onJump();
            if (isFailed) onMarkRead?.();
          }}
          style={{ fontSize: 14, padding: "0 4px", height: 24 }}
        >
          跳转
        </Button>
        {isActive && onCancel && (
          <Button
            type="link"
            size="small"
            danger
            icon={<StopOutlined />}
            onClick={onCancel}
            style={{ fontSize: 14, padding: "0 4px", height: 24 }}
          >
            取消
          </Button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export function TaskMonitor({ monitor, onJumpToTask }: TaskMonitorProps) {
  const [open, setOpen] = useState(false);
  const totalActive = monitor.activeCount + monitor.queuedCount;

  const handleCancel = async (taskId: string) => {
    try {
      await fetchJson(`/api/tasks/${taskId}/cancel`, { method: "POST" });
      void monitor.refresh();
    } catch {
      /* best effort */
    }
  };

  if (totalActive === 0 && monitor.failedUnreadCount === 0 && monitor.recentTasks.length === 0) {
    return null; // Nothing to show
  }

  return (
    <div className="fixed bottom-4 right-4 z-50">
      {/* Expanded panel */}
      {open && (
        <div className="mb-2 w-72 max-h-[70vh] overflow-y-auto rounded-xl border border-slate-700 bg-slate-950/95 shadow-2xl backdrop-blur-sm">
          {/* Header */}
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-800 bg-slate-950 px-3 py-2">
            <span className="text-xs font-medium text-slate-200">
              任务监控
            </span>
            <div className="flex items-center gap-1.5">
              <Button
                type="text"
                size="small"
                icon={<ReloadOutlined />}
                onClick={() => void monitor.refresh()}
                style={{ width: 28, height: 28, minWidth: 28 }}
              />
              <Button
                type="text"
                size="small"
                icon={<CloseOutlined />}
                onClick={() => setOpen(false)}
                style={{ width: 28, height: 28, minWidth: 28 }}
              />
            </div>
          </div>

          {/* Active / Queued */}
          {monitor.activeTasks.length > 0 && (
            <div className="p-2">
              <div className="mb-1.5 text-sm font-medium uppercase tracking-wider text-slate-500">
                Running / Queued ({monitor.activeTasks.length})
              </div>
              <div className="space-y-1.5">
                {monitor.activeTasks.map((t) => (
                  <TaskCard
                    key={t.id}
                    task={t}
                    onJump={() => onJumpToTask(t.scriptKey, t.sessionId)}
                    onCancel={() => void handleCancel(t.id)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Recent */}
          {monitor.recentTasks.length > 0 && (
            <div className="border-t border-slate-800 p-2">
              <div className="mb-1.5 text-sm font-medium uppercase tracking-wider text-slate-500">
                Recent ({monitor.recentTasks.length})
              </div>
              <div className="space-y-1.5">
                {monitor.recentTasks.slice(0, 20).map((t) => (
                  <TaskCard
                    key={t.id}
                    task={t}
                    onJump={() => onJumpToTask(t.scriptKey, t.sessionId)}
                    onMarkRead={() => monitor.markRead(t.id)}
                  />
                ))}
              </div>
            </div>
          )}

          {monitor.activeTasks.length === 0 && monitor.recentTasks.length === 0 && (
            <div className="p-4">
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No tasks" />
            </div>
          )}
        </div>
      )}

      {/* Badge button */}
      <Tooltip title={open ? "" : `${totalActive} active, ${monitor.failedUnreadCount} failed`} placement="left">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium shadow-lg transition ${
            monitor.badgeStatus === "failed"
              ? "animate-pulse border-red-500/60 bg-red-950/90 text-red-300"
              : monitor.badgeStatus === "running"
                ? "border-blue-500/40 bg-slate-900/95 text-blue-300"
                : "border-slate-700 bg-slate-900/95 text-slate-300"
          }`}
        >
          <Badge
            color={badgeColor(monitor.badgeStatus)}
            dot={monitor.badgeStatus !== "idle"}
            style={{ marginRight: 0 }}
          />
          {totalActive > 0 && (
            <span>{totalActive} 运行中</span>
          )}
          {monitor.failedUnreadCount > 0 && (
            <span className="text-red-400">{monitor.failedUnreadCount} 失败</span>
          )}
          {totalActive === 0 && monitor.failedUnreadCount === 0 && (
            <span>任务</span>
          )}
        </button>
      </Tooltip>
    </div>
  );
}
