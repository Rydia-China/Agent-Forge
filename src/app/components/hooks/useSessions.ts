"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchJson, getErrorMessage } from "../client-utils";
import type { SessionSummary } from "../../types";

export interface UseSessionsReturn {
  sessions: SessionSummary[];
  isLoadingSessions: boolean;
  refreshSessions: () => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
}

export function useSessions(
  userName: string,
  onError: (msg: string) => void,
  onNotice: (msg: string) => void,
): UseSessionsReturn {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);

  const refreshSessions = useCallback(async () => {
    setIsLoadingSessions(true);
    try {
      setSessions(
        await fetchJson<SessionSummary[]>(
          `/api/sessions?user=${encodeURIComponent(userName)}`,
        ),
      );
    } catch (err: unknown) {
      onError(getErrorMessage(err, "Failed to load sessions."));
    } finally {
      setIsLoadingSessions(false);
    }
  }, [userName, onError]);

  const deleteSession = useCallback(
    async (sessionId: string) => {
      if (!confirm("确定永久删除此会话？")) return;
      try {
        await fetchJson(`/api/sessions/${sessionId}`, { method: "DELETE" });
        await refreshSessions();
        onNotice("已删除会话");
      } catch (err: unknown) {
        onError(getErrorMessage(err, "Failed to delete session."));
      }
    },
    [refreshSessions, onError, onNotice],
  );

  useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

  return { sessions, isLoadingSessions, refreshSessions, deleteSession };
}
