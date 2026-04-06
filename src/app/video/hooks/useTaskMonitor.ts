"use client";

/**
 * useTaskMonitor — novel-level task monitoring.
 *
 * - Fetches task list on mount and periodically
 * - Connects to novel task-feed SSE for real-time updates
 * - Tracks failed-unread state per task
 * - Provides badge counts and per-EP task status
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchJson, isRecord } from "@/app/components/client-utils";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface NovelTaskInfo {
  id: string;
  sessionId: string;
  status: string;
  scriptKey: string | null;
  sessionTitle: string | null;
  reply: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export type TaskBadgeStatus = "idle" | "running" | "queued" | "failed";

export interface EpTaskStatus {
  scriptKey: string;
  status: TaskBadgeStatus;
  taskId: string;
}

export interface UseTaskMonitorReturn {
  tasks: NovelTaskInfo[];
  activeTasks: NovelTaskInfo[];
  recentTasks: NovelTaskInfo[];
  activeCount: number;
  queuedCount: number;
  failedUnreadCount: number;
  badgeStatus: TaskBadgeStatus;
  epStatuses: Map<string, EpTaskStatus>;
  /** Mark a failed task as "read" (user has seen it). */
  markRead: (taskId: string) => void;
  /** Refresh task list from server. */
  refresh: () => Promise<void>;
  /** Whether any tasks are active (running or pending) for the novel. */
  hasActiveTasks: boolean;
}

/* ------------------------------------------------------------------ */
/*  Polling interval                                                   */
/* ------------------------------------------------------------------ */

const POLL_INTERVAL_MS = 15_000; // 15 seconds fallback poll

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export function useTaskMonitor(novelId: string): UseTaskMonitorReturn {
  const [tasks, setTasks] = useState<NovelTaskInfo[]>([]);
  const [failedReadSet, setFailedReadSet] = useState<Set<string>>(new Set());
  const mountedRef = useRef(true);

  /* ---- Fetch task list ---- */

  const fetchTasks = useCallback(async () => {
    try {
      const data = await fetchJson<NovelTaskInfo[]>(
        `/api/video/novels/${encodeURIComponent(novelId)}/tasks?limit=50`,
      );
      if (mountedRef.current) setTasks(data);
    } catch (err) {
      console.error("[useTaskMonitor] fetch failed:", err);
    }
  }, [novelId]);

  /* ---- SSE feed connection ---- */

  useEffect(() => {
    mountedRef.current = true;
    void fetchTasks();

    const es = new EventSource(
      `/api/video/novels/${encodeURIComponent(novelId)}/task-feed`,
    );

    const handleFeedEvent = () => {
      // On any novel feed event, re-fetch the full list for consistency
      void fetchTasks();
    };

    es.addEventListener("task_queued", handleFeedEvent);
    es.addEventListener("task_started", handleFeedEvent);
    es.addEventListener("task_completed", handleFeedEvent);
    es.addEventListener("task_failed", handleFeedEvent);
    es.addEventListener("task_cancelled", handleFeedEvent);

    // Fallback polling in case SSE drops
    const pollTimer = setInterval(() => {
      void fetchTasks();
    }, POLL_INTERVAL_MS);

    return () => {
      mountedRef.current = false;
      es.close();
      clearInterval(pollTimer);
    };
  }, [novelId, fetchTasks]);

  /* ---- Derived state ---- */

  const activeTasks = tasks.filter(
    (t) => t.status === "running" || t.status === "pending",
  );
  const recentTasks = tasks.filter(
    (t) => t.status === "completed" || t.status === "failed" || t.status === "cancelled",
  );
  // Sort recent: failed first, then by updatedAt desc
  recentTasks.sort((a, b) => {
    if (a.status === "failed" && b.status !== "failed") return -1;
    if (a.status !== "failed" && b.status === "failed") return 1;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });

  const activeCount = tasks.filter((t) => t.status === "running").length;
  const queuedCount = tasks.filter((t) => t.status === "pending").length;
  const failedUnread = recentTasks.filter(
    (t) => t.status === "failed" && !failedReadSet.has(t.id),
  );
  const failedUnreadCount = failedUnread.length;

  const badgeStatus: TaskBadgeStatus =
    failedUnreadCount > 0
      ? "failed"
      : activeCount > 0
        ? "running"
        : queuedCount > 0
          ? "queued"
          : "idle";

  /* ---- Per-EP status map ---- */

  const epStatuses = new Map<string, EpTaskStatus>();
  for (const t of tasks) {
    if (!t.scriptKey) continue;
    const existing = epStatuses.get(t.scriptKey);
    // Priority: running > pending > failed > completed
    const priority = (s: string) =>
      s === "running" ? 4 : s === "pending" ? 3 : s === "failed" ? 2 : 1;
    const tStatus: TaskBadgeStatus =
      t.status === "running"
        ? "running"
        : t.status === "pending"
          ? "queued"
          : t.status === "failed" && !failedReadSet.has(t.id)
            ? "failed"
            : "idle";
    if (!existing || priority(t.status) > priority(existing.status === "queued" ? "pending" : existing.status)) {
      epStatuses.set(t.scriptKey, {
        scriptKey: t.scriptKey,
        status: tStatus,
        taskId: t.id,
      });
    }
  }

  /* ---- Novel-level tasks (scriptKey is null) included in active count ---- */

  const hasActiveTasks = activeTasks.length > 0;

  /* ---- Actions ---- */

  const markRead = useCallback((taskId: string) => {
    setFailedReadSet((prev) => new Set(prev).add(taskId));
  }, []);

  return {
    tasks,
    activeTasks,
    recentTasks,
    activeCount,
    queuedCount,
    failedUnreadCount,
    badgeStatus,
    epStatuses,
    markRead,
    refresh: fetchTasks,
    hasActiveTasks,
  };
}
