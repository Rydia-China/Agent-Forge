"use client";

import { useCallback, useRef, useState } from "react";
import { Button } from "antd";
import { AppstoreOutlined } from "@ant-design/icons";
import { AgentPanel } from "./components/AgentPanel";
import { SessionSidebar } from "./components/SessionSidebar";
import { ResourceDrawer } from "./components/ResourceDrawer";
import { ResourceDetailDrawer } from "./components/ResourceDetailDrawer";
import { useUser } from "./components/hooks/useUser";
import { useSessions } from "./components/hooks/useSessions";
import { useResources } from "./components/hooks/useResources";
import { useResourceDetail } from "./components/hooks/useResourceDetail";

export default function Home() {
  const [currentSessionId, setCurrentSessionId] = useState<string | undefined>();
  const [panelKey, setPanelKey] = useState(() => crypto.randomUUID());
  const [showResources, setShowResources] = useState(false);
  const currentSessionIdRef = useRef<string | undefined>(undefined);

  const switchSession = useCallback((sessionId?: string) => {
    setCurrentSessionId(sessionId);
    currentSessionIdRef.current = sessionId;
    setPanelKey(crypto.randomUUID());
  }, []);

  const user = useUser(() => switchSession(undefined));

  const resources = useResources(currentSessionIdRef, () => {});

  const resourceDetail = useResourceDetail(
    resources.loadResources,
    resources.builtinSkills,
    resources.dbSkills,
    resources.builtinMcps,
    resources.mcps,
  );

  const sessionsHook = useSessions(
    user.userName,
    () => {}, // errors handled in resource detail
    () => {},
  );

  const handleRefresh = useCallback(() => {
    void sessionsHook.refreshSessions();
    void resources.loadResources();
  }, [sessionsHook, resources]);

  const handleDeleteSession = useCallback(
    async (sessionId: string) => {
      await sessionsHook.deleteSession(sessionId);
      if (currentSessionIdRef.current === sessionId) switchSession(undefined);
    },
    [sessionsHook, switchSession],
  );

  return (
    <main className="flex h-screen w-full bg-slate-950 text-slate-100">
      <SessionSidebar
        userDraft={user.userDraft}
        setUserDraft={user.setUserDraft}
        applyUserName={user.applyUserName}
        sessions={sessionsHook.sessions}
        isLoadingSessions={sessionsHook.isLoadingSessions}
        refreshSessions={() => void sessionsHook.refreshSessions()}
        currentSessionId={currentSessionId}
        switchSession={switchSession}
        deleteSession={(id) => void handleDeleteSession(id)}
      />

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center border-b border-slate-800 px-3 py-1.5">
          <div className="ml-auto">
            <Button
              size="small"
              type={showResources ? "primary" : "default"}
              ghost={showResources}
              icon={<AppstoreOutlined />}
              onClick={() => setShowResources((v) => !v)}
            >
              Resources
            </Button>
          </div>
        </header>
        <AgentPanel
          key={panelKey}
          initialSessionId={currentSessionId}
          userName={user.userName}
          onStatusChange={() => {}}
          onSessionCreated={(sid) => {
            setCurrentSessionId(sid);
            currentSessionIdRef.current = sid;
          }}
          onTitleChange={() => {}}
          onRefreshNeeded={handleRefresh}
        />
      </section>

      <ResourceDrawer
        open={showResources}
        builtinSkills={resources.builtinSkills}
        dbSkills={resources.dbSkills}
        builtinMcps={resources.builtinMcps}
        mcps={resources.mcps}
        isLoadingResources={resources.isLoadingResources}
        error={resourceDetail.error}
        notice={resourceDetail.notice}
        onLoadResources={() => void resources.loadResources()}
        onSelectResource={(r) => void resourceDetail.loadResourceDetail(r)}
        onClose={() => setShowResources(false)}
      />

      <ResourceDetailDrawer detail={resourceDetail} />
    </main>
  );
}
