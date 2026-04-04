"use client";

import { useCallback, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { ConfigProvider, theme as antTheme } from "antd";
import { useSessions } from "@/app/components/hooks/useSessions";
import { useVideoData } from "../hooks/useVideoData";
import { EpisodeList } from "../components/EpisodeList";
import { ResourcePanel } from "../components/ResourcePanel";
import { VideoChat } from "../components/VideoChat";
import type { VideoContext } from "../types";

/* ------------------------------------------------------------------ */
/*  Default skills & MCPs for video workflow                           */
/* ------------------------------------------------------------------ */

const DEFAULT_SKILLS = ["ep-video-workflow"];

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function VideoWorkflowPage() {
  const params = useParams<{ novelId: string }>();
  const searchParams = useSearchParams();
  const novelId = params.novelId;
  const novelName = searchParams.get("name") ?? novelId;

  /* ---- Data ---- */
  const data = useVideoData(novelId);

  /* ---- Session management ---- */
  const userName = data.selectedEpisode
    ? `video:${novelId}:${data.selectedEpisode.scriptKey}`
    : `video:${novelId}:_`;

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

  /* ---- Video context for chat ---- */
  const videoContext: VideoContext | null = useMemo(() => {
    if (!data.selectedEpisode) return null;
    return {
      novelId,
      scriptId: data.selectedEpisode.id,
      scriptKey: data.selectedEpisode.scriptKey,
    };
  }, [novelId, data.selectedEpisode]);

  /* ---- Handlers ---- */
  const handleSelectEpisode = useCallback(
    (ep: typeof data.episodes[number]) => {
      data.selectEpisode(ep);
      setCurrentSessionId(undefined);
      setChatKey(crypto.randomUUID());
    },
    [data],
  );

  const handleSessionCreated = useCallback(
    (sessionId: string) => {
      setCurrentSessionId(sessionId);
      void sessionsHook.refreshSessions();
    },
    [sessionsHook],
  );

  const handleRefreshNeeded = useCallback(() => {
    void data.refreshAll();
    void sessionsHook.refreshSessions();
  }, [data, sessionsHook]);

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
          episodes={data.episodes}
          isLoading={data.isLoadingEpisodes}
          selectedEpisode={data.selectedEpisode}
          onSelectEpisode={handleSelectEpisode}
          onDeleteEpisode={(ep) => { if (confirm(`Delete ${ep.scriptKey}?`)) void data.deleteEpisode(ep.id); }}
          onRefresh={() => void data.refreshEpisodes()}
          sessions={sessionsHook.sessions}
          currentSessionId={currentSessionId}
          onSelectSession={switchSession}
          onNewSession={handleNewSession}
          onDeleteSession={(id) => void handleDeleteSession(id)}
        />

        {/* Center — Chat */}
        <section className="min-w-0 flex-1">
          <VideoChat
            key={chatKey}
            initialSessionId={currentSessionId}
            videoContext={videoContext}
            skills={DEFAULT_SKILLS}
            onSessionCreated={handleSessionCreated}
            onRefreshNeeded={handleRefreshNeeded}
            episodeStatus={data.selectedEpisode?.status}
          />
        </section>

        {/* Right panel — Resources */}
        <ResourcePanel
          resources={data.resources}
          isLoading={data.isLoadingResources}
          scriptId={data.selectedEpisode?.id ?? null}
          sessionId={currentSessionId}
          onRefresh={() => void data.refreshResources()}
        />
      </main>
    </ConfigProvider>
  );
}
