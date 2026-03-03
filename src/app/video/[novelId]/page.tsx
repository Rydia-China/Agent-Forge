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

const DEFAULT_SKILLS = ["novel-video-workflow", "novel-character-card"];
const DEFAULT_MCPS = ["novel-service"];

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
  const [autoMessage, setAutoMessage] = useState<string | undefined>();

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
      scriptKey: data.selectedEpisode.scriptKey,
    };
  }, [novelId, data.selectedEpisode]);

  /* ---- Handlers ---- */
  const handleSelectEpisode = useCallback(
    (ep: typeof data.episodes[number]) => {
      data.selectEpisode(ep);
      setCurrentSessionId(undefined);
      setAutoMessage(undefined);
      setChatKey(crypto.randomUUID());
    },
    [data],
  );

  const handleUpload = useCallback(
    async (scriptKey: string, scriptName: string | null, content: string | null) => {
      await data.uploadEpisode(scriptKey, scriptName, content);
      // Auto-select the newly uploaded EP and trigger first chat
      const refreshed = await data.refreshEpisodes();
      const newEp = refreshed.find((ep) => ep.scriptKey === scriptKey);
      if (newEp) {
        data.selectEpisode(newEp);
        setCurrentSessionId(undefined);
setAutoMessage("EP已上传，请开始小说可视化工作流：人物卡 → 分镜 → 图片 → 视频，逐步推进");
        setChatKey(crypto.randomUUID());
      }
    },
    [data],
  );

  const handleSessionCreated = useCallback(
    (sessionId: string) => {
      setCurrentSessionId(sessionId);
      setAutoMessage(undefined);
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
          isUploading={data.isUploading}
          selectedEpisode={data.selectedEpisode}
          onSelectEpisode={handleSelectEpisode}
          onDeleteEpisode={(ep) => { if (confirm(`Delete ${ep.scriptKey}?`)) void data.deleteEpisode(ep.id); }}
          onRefresh={() => void data.refreshEpisodes()}
          onUpload={(key, name, content) => void handleUpload(key, name, content)}
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
            preloadMcps={DEFAULT_MCPS}
            skills={DEFAULT_SKILLS}
            onSessionCreated={handleSessionCreated}
            onRefreshNeeded={handleRefreshNeeded}
            autoMessage={autoMessage}
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
