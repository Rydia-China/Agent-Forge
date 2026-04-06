"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { App, ConfigProvider, message, theme as antTheme } from "antd";
import { useSessions } from "@/app/components/hooks/useSessions";
import { useVideoData } from "../hooks/useVideoData";
import { useNovelResources } from "../hooks/useNovelResources";
import { useTaskMonitor } from "../hooks/useTaskMonitor";
import { useTaskNotifications } from "../hooks/useTaskNotifications";
import { EpisodeList } from "../components/EpisodeList";
import { ResourcePanel } from "../components/ResourcePanel";
import { VideoChat } from "../components/VideoChat";
import { NovelChat } from "../components/NovelChat";
import { TaskMonitor } from "../components/TaskMonitor";
import { fetchJson } from "@/app/components/client-utils";
import type { VideoContext } from "../types";

/* ------------------------------------------------------------------ */
/*  Default skills                                                     */
/* ------------------------------------------------------------------ */

const NOVEL_SKILLS = ["novel-video-planner"];
const EP_SKILLS = ["ep-video-planner"];

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function VideoWorkflowPage() {
  const params = useParams<{ novelId: string }>();
  const searchParams = useSearchParams();
  const novelId = params.novelId;
  const novelName = searchParams.get("name") ?? novelId;

  /* ---- Mode: novel-level or EP-level ---- */
  const [isNovelLevel, setIsNovelLevel] = useState(true);

  /* ---- Data ---- */
  const epData = useVideoData(novelId);
  const novelData = useNovelResources(novelId);
  const taskMonitor = useTaskMonitor(novelId);

  /* ---- Session management ---- */
  const userName = useMemo(() => {
    if (isNovelLevel) return `video:${novelId}`;
    if (epData.selectedEpisode) return `video:${novelId}:${epData.selectedEpisode.scriptKey}`;
    return `video:${novelId}:_`;
  }, [isNovelLevel, novelId, epData.selectedEpisode]);

  const sessionsHook = useSessions(userName, () => {}, () => {});
  const [currentSessionId, setCurrentSessionId] = useState<string | undefined>();
  const [chatKey, setChatKey] = useState(() => crypto.randomUUID());

  const switchSession = useCallback((sessionId?: string) => {
    setCurrentSessionId(sessionId);
    setChatKey(crypto.randomUUID());
  }, []);

  const handleNewSession = useCallback(() => {
    switchSession(undefined);
  }, [switchSession]);

  const handleDeleteSession = useCallback(
    async (sessionId: string) => {
      await sessionsHook.deleteSession(sessionId);
      if (currentSessionId === sessionId) switchSession(undefined);
    },
    [sessionsHook, currentSessionId, switchSession],
  );

  /* ---- Auto-select first novel session on initial load ---- */
  const hasAutoSelectedRef = useRef(false);

  /* ---- Auto-select session when switching episodes ---- */
  const pendingEpAutoSelect = useRef<string | null>(null);
  const sawSessionLoading = useRef(false);

  useEffect(() => {
    if (hasAutoSelectedRef.current) return;
    if (sessionsHook.isLoadingSessions) return;
    hasAutoSelectedRef.current = true;
    if (isNovelLevel && sessionsHook.sessions.length > 0) {
      const first = sessionsHook.sessions[0];
      if (first) switchSession(first.id);
    }
  }, [sessionsHook.isLoadingSessions, sessionsHook.sessions, isNovelLevel, switchSession]);

  /* ---- Auto-select session after episode switch ---- */
  useEffect(() => {
    if (!pendingEpAutoSelect.current) return;

    if (sessionsHook.isLoadingSessions) {
      sawSessionLoading.current = true;
      return;
    }
    // Wait until sessions have been re-fetched for the new episode
    if (!sawSessionLoading.current) return;

    const targetScriptKey = pendingEpAutoSelect.current;
    pendingEpAutoSelect.current = null;
    sawSessionLoading.current = false;

    const sessions = sessionsHook.sessions;
    if (sessions.length === 0) return;

    // Priority: session with running/pending task for this episode
    const activeTask = taskMonitor.tasks.find(
      (t) => t.scriptKey === targetScriptKey && (t.status === "running" || t.status === "pending"),
    );
    if (activeTask) {
      const match = sessions.find((s) => s.id === activeTask.sessionId);
      if (match) {
        switchSession(match.id);
        return;
      }
    }

    // Fallback: most recently created session
    const sorted = [...sessions].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    const last = sorted[0];
    if (last) {
      switchSession(last.id);
    }
  }, [sessionsHook.isLoadingSessions, sessionsHook.sessions, taskMonitor.tasks, switchSession]);

  /* ---- Video context for EP-level chat ---- */
  const videoContext: VideoContext | null = useMemo(() => {
    if (isNovelLevel || !epData.selectedEpisode) return null;
    return {
      novelId,
      scriptId: epData.selectedEpisode.id,
      scriptKey: epData.selectedEpisode.scriptKey,
    };
  }, [isNovelLevel, novelId, epData.selectedEpisode]);

  /* ---- Handlers ---- */
  const handleSelectNovelLevel = useCallback(() => {
    setIsNovelLevel(true);
    setCurrentSessionId(undefined);
    setChatKey(crypto.randomUUID());
  }, []);

  const handleSelectEpisode = useCallback(
    (ep: typeof epData.episodes[number]) => {
      setIsNovelLevel(false);
      epData.selectEpisode(ep);
      pendingEpAutoSelect.current = ep.scriptKey;
      sawSessionLoading.current = false;
      setCurrentSessionId(undefined);
      setChatKey(crypto.randomUUID());
    },
    [epData],
  );

  const handleSessionCreated = useCallback(
    (sessionId: string) => {
      setCurrentSessionId(sessionId);
      void sessionsHook.refreshSessions();
    },
    [sessionsHook],
  );

  /* ---- Re-upload script ---- */
  const [isReUploading, setIsReUploading] = useState(false);

  const handleReUpload = useCallback(
    async (jsonData: unknown) => {
      setIsReUploading(true);
      try {
        await fetchJson(
          `/api/video/novels/${encodeURIComponent(novelId)}/upload-script`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(jsonData),
          },
        );
        void epData.refreshEpisodes();
        void novelData.refresh();
        void message.success("剧本数据已更新");
      } catch (err: unknown) {
        void message.error(
          err instanceof Error ? err.message : "重传失败",
        );
      } finally {
        setIsReUploading(false);
      }
    },
    [novelId, epData, novelData],
  );

  const handleRefreshNeeded = useCallback(() => {
    if (isNovelLevel) {
      void novelData.refresh();
    } else {
      void epData.refreshAll();
    }
    void sessionsHook.refreshSessions();
  }, [isNovelLevel, epData, novelData, sessionsHook]);

  /* ---- Jump-to-task logic (shared across monitor, notifications, EP dots) ---- */
  const handleJumpToTask = useCallback(
    (scriptKey: string | null, sessionId: string) => {
      if (scriptKey) {
        // EP-level task
        const ep = epData.episodes.find((e) => e.scriptKey === scriptKey);
        if (ep) {
          setIsNovelLevel(false);
          epData.selectEpisode(ep);
        }
      } else {
        // Novel-level task
        setIsNovelLevel(true);
      }
      setCurrentSessionId(sessionId);
      setChatKey(crypto.randomUUID());
    },
    [epData],
  );

  /* ---- Notifications ---- */
  useTaskNotifications({
    novelId,
    currentSessionId,
    onJumpToTask: handleJumpToTask,
  });

  /* ---- beforeunload protection ---- */
  useEffect(() => {
    if (!taskMonitor.hasActiveTasks) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [taskMonitor.hasActiveTasks]);

  return (
    <ConfigProvider
      theme={{
        algorithm: antTheme.darkAlgorithm,
        token: { colorBgContainer: "transparent" },
      }}
    >
      <main className="flex h-screen w-full bg-slate-950 text-slate-100">
        {/* Left panel — Episode list + sessions */}
        <EpisodeList
          novelName={novelName}
          episodes={epData.episodes}
          isLoading={epData.isLoadingEpisodes}
          selectedEpisode={epData.selectedEpisode}
          onSelectEpisode={handleSelectEpisode}
          onRefresh={() => void epData.refreshEpisodes()}
          onReUpload={(json) => void handleReUpload(json)}
          isReUploading={isReUploading}
          sessions={sessionsHook.sessions}
          currentSessionId={currentSessionId}
          onSelectSession={switchSession}
          onNewSession={handleNewSession}
          onDeleteSession={(id) => void handleDeleteSession(id)}
          isNovelLevelSelected={isNovelLevel}
          onSelectNovelLevel={handleSelectNovelLevel}
          epTaskStatuses={taskMonitor.epStatuses}
        />

        {/* Center — Chat */}
        <section className="min-w-0 flex-1">
          {isNovelLevel ? (
            <NovelChat
              key={chatKey}
              novelId={novelId}
              initialSessionId={currentSessionId}
              skills={NOVEL_SKILLS}
              onSessionCreated={handleSessionCreated}
              onRefreshNeeded={handleRefreshNeeded}
              showEmptyState={!currentSessionId && sessionsHook.sessions.length === 0 && !sessionsHook.isLoadingSessions}
            />
          ) : (
            <VideoChat
              key={chatKey}
              initialSessionId={currentSessionId}
              videoContext={videoContext}
              skills={EP_SKILLS}
              onSessionCreated={handleSessionCreated}
              onRefreshNeeded={handleRefreshNeeded}
              episodeStatus={epData.selectedEpisode?.status}
            />
          )}
        </section>

        {/* Right panel — Resources */}
        <ResourcePanel
          resources={isNovelLevel ? novelData.resources : epData.resources}
          isLoading={isNovelLevel ? novelData.isLoading : epData.isLoadingResources}
          novelId={novelId}
          scriptId={isNovelLevel ? null : epData.selectedEpisode?.id ?? null}
          sessionId={currentSessionId}
          onRefresh={() => isNovelLevel ? void novelData.refresh() : void epData.refreshResources()}
        />
        {/* Task Monitor floating panel */}
        <TaskMonitor
          monitor={taskMonitor}
          onJumpToTask={handleJumpToTask}
        />
      </main>
    </ConfigProvider>
  );
}
