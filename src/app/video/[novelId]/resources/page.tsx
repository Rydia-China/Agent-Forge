"use client";

import { useCallback, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { ConfigProvider, theme as antTheme, Button } from "antd";
import { ArrowLeftOutlined } from "@ant-design/icons";
import Link from "next/link";
import { useSessions } from "@/app/components/hooks/useSessions";
import { ResourcePanel } from "../../components/ResourcePanel";
import { NovelChat } from "../../components/NovelChat";
import { useNovelResources } from "../../hooks/useNovelResources";

/* ------------------------------------------------------------------ */
/*  Default skills for novel-level resource management                */
/* ------------------------------------------------------------------ */

const DEFAULT_SKILLS = ["novel-video-planner"];

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function NovelResourcesPage() {
  const params = useParams<{ novelId: string }>();
  const searchParams = useSearchParams();
  const novelId = params.novelId;
  const novelName = searchParams.get("name") ?? novelId;

  /* ---- Data ---- */
  const { resources, isLoading, refresh } = useNovelResources(novelId);

  /* ---- Session management ---- */
  const userName = `video:${novelId}`;
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

  const handleSessionCreated = useCallback(
    (sessionId: string) => {
      setCurrentSessionId(sessionId);
      void sessionsHook.refreshSessions();
    },
    [sessionsHook],
  );

  const handleRefreshNeeded = useCallback(() => {
    void refresh();
    void sessionsHook.refreshSessions();
  }, [refresh, sessionsHook]);

  return (
    <ConfigProvider
      theme={{
        algorithm: antTheme.darkAlgorithm,
        token: { colorBgContainer: "transparent" },
      }}
    >
      <main className="flex h-screen w-full flex-col bg-slate-950 text-slate-100">
        {/* Header */}
        <header className="flex items-center gap-3 border-b border-slate-800 px-4 py-3">
          <Link href={`/video/${novelId}`}>
            <Button type="text" size="small" icon={<ArrowLeftOutlined />} className="!text-slate-400 hover:!text-slate-200">
              返回EP列表
            </Button>
          </Link>
          <h1 className="text-sm font-medium text-slate-300">小说资源管理: {novelName}</h1>
        </header>

        {/* Main content */}
        <div className="flex min-h-0 flex-1">
          {/* Left sidebar — Sessions */}
          <aside className="flex w-64 flex-col border-r border-slate-800 bg-slate-900/40">
            <div className="border-b border-slate-800 px-3 py-2">
              <Button type="primary" size="small" block onClick={handleNewSession}>
                新建对话
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {sessionsHook.sessions.map((s) => (
                <div
                  key={s.id}
                  className={`cursor-pointer border-b border-slate-800 px-3 py-2 text-xs transition hover:bg-slate-800/50 ${
                    currentSessionId === s.id ? "bg-slate-800" : ""
                  }`}
                  onClick={() => switchSession(s.id)}
                >
                  <div className="truncate font-medium">{s.title || "未命名对话"}</div>
                  <div className="mt-0.5 text-[10px] text-slate-500">
                    {new Date(s.updatedAt).toLocaleString("zh-CN")}
                  </div>
                </div>
              ))}
            </div>
          </aside>

          {/* Center — Chat */}
          <section className="min-w-0 flex-1">
            <NovelChat
              key={chatKey}
              novelId={novelId}
              initialSessionId={currentSessionId}
              skills={DEFAULT_SKILLS}
              onSessionCreated={handleSessionCreated}
              onRefreshNeeded={handleRefreshNeeded}
            />
          </section>

          {/* Right panel — Resources */}
          <ResourcePanel
            resources={resources}
            isLoading={isLoading}
            novelId={novelId}
            scriptId={null}
            sessionId={currentSessionId}
            onRefresh={() => void refresh()}
          />
        </div>
      </main>
    </ConfigProvider>
  );
}
