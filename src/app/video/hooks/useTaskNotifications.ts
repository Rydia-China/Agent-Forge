"use client";

/**
 * useTaskNotifications — page toast + browser Notification for task events.
 *
 * Listens to the novel task-feed SSE and fires notifications when:
 * - A task completes or fails while the user is NOT currently viewing it
 * - The page is not focused (browser Notification)
 */

import { useEffect, useRef } from "react";
import { App } from "antd";
import type { NovelTaskInfo } from "./useTaskMonitor";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface UseTaskNotificationsOpts {
  novelId: string;
  /** Currently viewed session ID (to suppress toast for the task the user is watching). */
  currentSessionId: string | undefined;
  /** Callback to jump to a task. */
  onJumpToTask: (scriptKey: string | null, sessionId: string) => void;
}

/* ------------------------------------------------------------------ */
/*  Browser Notification helper                                        */
/* ------------------------------------------------------------------ */

function requestNotificationPermission(): void {
  if (typeof Notification !== "undefined" && Notification.permission === "default") {
    void Notification.requestPermission();
  }
}

function sendBrowserNotification(
  title: string,
  body: string,
  onClick?: () => void,
): void {
  if (typeof Notification === "undefined") return;
  if (Notification.permission !== "granted") return;
  if (document.hasFocus()) return; // Only when page is not focused

  const n = new Notification(title, {
    body,
    icon: "/favicon.ico",
    tag: "task-notification", // Collapse multiple
  });
  if (onClick) {
    n.onclick = () => {
      window.focus();
      onClick();
      n.close();
    };
  }
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export function useTaskNotifications({
  novelId,
  currentSessionId,
  onJumpToTask,
}: UseTaskNotificationsOpts): void {
  const { message } = App.useApp();
  const currentSessionRef = useRef(currentSessionId);
  currentSessionRef.current = currentSessionId;
  const onJumpRef = useRef(onJumpToTask);
  onJumpRef.current = onJumpToTask;

  // Request notification permission once on mount
  useEffect(() => {
    requestNotificationPermission();
  }, []);

  useEffect(() => {
    const es = new EventSource(
      `/api/video/novels/${encodeURIComponent(novelId)}/task-feed`,
    );

    const handleEvent = (e: MessageEvent) => {
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(e.data as string) as Record<string, unknown>;
      } catch {
        return;
      }

      const sessionId = typeof data.sessionId === "string" ? data.sessionId : null;
      const scriptKey = typeof data.scriptKey === "string" ? data.scriptKey : null;
      const eventType = e.type;
      const error = typeof data.error === "string" ? data.error : null;
      const label = scriptKey ?? "Novel";

      // Skip if user is currently viewing this session
      if (sessionId && sessionId === currentSessionRef.current) return;

      if (eventType === "task_completed") {
        void message.success({
          content: `${label} 任务完成`,
          duration: 5,
          onClick: () => {
            if (sessionId) onJumpRef.current(scriptKey, sessionId);
          },
        });
        sendBrowserNotification(
          `${label} 完成`,
          "任务已成功完成",
          () => { if (sessionId) onJumpRef.current(scriptKey, sessionId); },
        );
      } else if (eventType === "task_failed") {
        void message.error({
          content: `${label} 失败${error ? `：${error.slice(0, 60)}` : ""}`,
          duration: 10,
          onClick: () => {
            if (sessionId) onJumpRef.current(scriptKey, sessionId);
          },
        });
        sendBrowserNotification(
          `${label} 失败`,
          error?.slice(0, 100) ?? "任务执行出错",
          () => { if (sessionId) onJumpRef.current(scriptKey, sessionId); },
        );
      }
    };

    es.addEventListener("task_completed", handleEvent);
    es.addEventListener("task_failed", handleEvent);

    return () => {
      es.close();
    };
  }, [novelId, message]);
}
