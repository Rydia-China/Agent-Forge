"use client";

import { useCallback, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { ConfigProvider, theme as antTheme } from "antd";
import { useSessions } from "@/app/components/hooks/useSessions";
import { useVideoData } from "../hooks/useVideoData";
import { useNovelResources } from "../hooks/useNovelResources";
import { EpisodeList } from "../components/EpisodeList";
import { ResourcePanel } from "../components/ResourcePanel";
import { VideoChat } from "../components/VideoChat";
import { NovelChat } from "../components/NovelChat";
import type { VideoContext } from "../types";

/* ------------------------------------------------------------------ */
/*  Default skills                                                     */
/* ------------------------------------------------------------------ */

const NOVEL_SKILLS = ["novel-resource-mgr"];
const EP_SKILLS = ["ep-video-workflow"];

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function VideoWorkflowPage() {
  const params = useParams<{ novelId: string }>();
  const searchParams = useSearchParams();
  const novelId = params.novelId;
  const novelName = searchParams.get("name") ?? novelId;

  /* ---- Mode: novel-level or EP-level ---- */
  const [isNovelLevel, setIsNovelLevel] = useState(false);

  /* ---- Data ---- */
  const epData = useVideoData(novelId);
  const novelData = useNovelResources(novelId);

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

  const handleRefreshNeeded = useCallback(() => {
    if (isNovelLevel) {
      void novelData.refresh();
    } else {
      void epData.refreshAll();
    }
    void sessionsHook.refreshSessions();
  }, [isNovelLevel, epData, novelData, sessionsHook]);

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
          onDeleteEpisode={(ep) => { if (confirm(`Delete ${ep.scriptKey}?`)) void epData.deleteEpisode(ep.id); }}
          onRefresh={() => void epData.refreshEpisodes()}
          sessions={sessionsHook.sessions}
          currentSessionId={currentSessionId}
          onSelectSession={switchSession}
          onNewSession={handleNewSession}
          onDeleteSession={(id) => void handleDeleteSession(id)}
          isNovelLevelSelected={isNovelLevel}
          onSelectNovelLevel={handleSelectNovelLevel}
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
          scriptId={isNovelLevel ? null : epData.selectedEpisode?.id ?? null}
          sessionId={currentSessionId}
          onRefresh={() => isNovelLevel ? void novelData.refresh() : void epData.refreshResources()}
        />
      </main>
    </ConfigProvider>
  );
}
