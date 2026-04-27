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
/*  Video-specific agent split                                         */
/* ------------------------------------------------------------------ */

const NOVEL_SKILLS = ["novel-resource-mgr"];
const EP_SKILLS = ["ep-video-workflow"];

type PageMode = "novel" | "episode";

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function VideoWorkflowPage() {
  const params = useParams<{ novelId: string }>();
  const searchParams = useSearchParams();
  const novelId = params.novelId;
  const novelName = searchParams.get("name") ?? novelId;

  const [pageMode, setPageMode] = useState<PageMode>("novel");
  const isNovelMode = pageMode === "novel";

  /* ---- Data ---- */
  const epData = useVideoData(novelId);
  const novelData = useNovelResources(novelId);

  /* ---- Session management ---- */
  const userName = useMemo(() => {
    if (isNovelMode) return `video:${novelId}`;
    if (epData.selectedEpisode) return `video:${novelId}:${epData.selectedEpisode.scriptKey}`;
    return `video:${novelId}:_`;
  }, [isNovelMode, novelId, epData.selectedEpisode]);

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
    if (isNovelMode || !epData.selectedEpisode) return null;
    return {
      novelId,
      scriptId: epData.selectedEpisode.id,
      scriptKey: epData.selectedEpisode.scriptKey,
    };
  }, [isNovelMode, novelId, epData.selectedEpisode]);

  /* ---- Handlers ---- */
  const handleSelectNovelLevel = useCallback(() => {
    setPageMode("novel");
    setCurrentSessionId(undefined);
    setChatKey(crypto.randomUUID());
  }, []);

  const handleSelectEpisode = useCallback(
    (ep: typeof epData.episodes[number]) => {
      setPageMode("episode");
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
    if (isNovelMode) {
      void novelData.refresh();
    } else {
      void epData.refreshAll();
    }
    void sessionsHook.refreshSessions();
  }, [isNovelMode, epData, novelData, sessionsHook]);

  return (
    <ConfigProvider
      theme={{
        algorithm: antTheme.darkAlgorithm,
        token: { colorBgContainer: "transparent" },
      }}
    >
      <main className="flex h-screen w-full bg-slate-950 text-slate-100">
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
          isNovelLevelSelected={isNovelMode}
          onSelectNovelLevel={handleSelectNovelLevel}
        />

        <section className="min-w-0 flex-1">
          {isNovelMode ? (
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
            />
          )}
        </section>

        <ResourcePanel
          resources={isNovelMode ? novelData.resources : epData.resources}
          isLoading={isNovelMode ? novelData.isLoading : epData.isLoadingResources}
          novelId={novelId}
          scriptId={isNovelMode ? null : epData.selectedEpisode?.id ?? null}
          sessionId={currentSessionId}
          isNovelLevel={isNovelMode}
          onRefresh={() => isNovelMode ? void novelData.refresh() : void epData.refreshResources()}
        />
      </main>
    </ConfigProvider>
  );
}
