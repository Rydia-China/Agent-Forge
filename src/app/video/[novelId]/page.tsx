"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { ConfigProvider, theme as antTheme } from "antd";
import { useSessions } from "@/app/components/hooks/useSessions";
import { useVideoData } from "../hooks/useVideoData";
import { EpisodeList } from "../components/EpisodeList";
import { StoryboardView } from "../components/StoryboardView";
import { ResourcePanel } from "../components/ResourcePanel";
import { VideoChat } from "../components/VideoChat";
import type { KeyResourceItem } from "@/app/types";
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
      novelName,
      scriptKey: data.selectedEpisode.scriptKey,
    };
  }, [novelId, novelName, data.selectedEpisode]);

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
setAutoMessage("请根据EP内容，执行全部视频工作流");
        setChatKey(crypto.randomUUID());
      }
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

  /* ---- Key resources ---- */
  const [keyResources, setKeyResources] = useState<KeyResourceItem[]>([]);
  const krHandlersRef = useRef<{
    update: (id: string, data: unknown, title?: string) => Promise<void>;
    delete: (id: string) => Promise<void>;
  } | null>(null);

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
          onUpload={(key, name, content) => void handleUpload(key, name, content)}
          sessions={sessionsHook.sessions}
          currentSessionId={currentSessionId}
          onSelectSession={switchSession}
          onNewSession={handleNewSession}
          onDeleteSession={(id) => void handleDeleteSession(id)}
        />

        {/* Center — Storyboard (left) + Chat (right), side by side */}
        <section className="flex min-w-0 flex-1">
          {data.storyboard.length > 0 && (
            <div className="h-full w-80 shrink-0 overflow-y-auto border-r border-slate-800">
              <StoryboardView
                scenes={data.storyboard}
                isLoading={data.isLoadingStoryboard}
                scriptKey={data.selectedEpisode?.scriptKey ?? null}
                episodeId={data.selectedEpisode?.id ?? null}
              />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <VideoChat
              key={chatKey}
              initialSessionId={currentSessionId}
              videoContext={videoContext}
              preloadMcps={DEFAULT_MCPS}
              skills={DEFAULT_SKILLS}
              onSessionCreated={handleSessionCreated}
              onRefreshNeeded={handleRefreshNeeded}
              autoMessage={autoMessage}
              onKeyResourcesChange={setKeyResources}
              onKeyResourceHandlers={(h) => { krHandlersRef.current = h; }}
            />
          </div>
        </section>

        {/* Right panel — Resources */}
        <ResourcePanel
          resources={data.resources}
          isLoading={data.isLoadingResources}
          keyResources={keyResources}
          onUpdateKeyResource={(id, d, t) => krHandlersRef.current?.update(id, d, t) ?? Promise.resolve()}
          onDeleteKeyResource={(id) => krHandlersRef.current?.delete(id) ?? Promise.resolve()}
        />
      </main>
    </ConfigProvider>
  );
}
