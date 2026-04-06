"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AgentPanel } from "./components/AgentPanel";
import { SessionSidebar } from "./components/SessionSidebar";
import { McpDrawer } from "./components/McpDrawer";
import { McpDetailDrawer } from "./components/McpDetailDrawer";
import { useUser } from "./components/hooks/useUser";
import { useSessions } from "./components/hooks/useSessions";
import { useMcp } from "./components/hooks/useMcp";
import { useMcpDetail } from "./components/hooks/useMcpDetail";

export default function Home() {
  const [currentSessionId, setCurrentSessionId] = useState<string | undefined>();
  const [panelKey, setPanelKey] = useState(() => crypto.randomUUID());
  const [showMcp, setShowMcp] = useState(false);
  const currentSessionIdRef = useRef<string | undefined>(undefined);

  const switchSession = useCallback((sessionId?: string) => {
    setCurrentSessionId(sessionId);
    currentSessionIdRef.current = sessionId;
    setPanelKey(crypto.randomUUID());
  }, []);

  const user = useUser(() => switchSession(undefined));

  const mcp = useMcp(currentSessionIdRef, () => {});

  const mcpDetail = useMcpDetail(
    mcp.loadMcp,
    mcp.builtinSkills,
    mcp.dbSkills,
    mcp.builtinMcps,
    mcp.mcps,
  );

  const sessionsHook = useSessions(
    user.userName,
    () => {}, // errors handled in resource detail
    () => {},
  );

  const refreshSessionsRef = useRef(sessionsHook.refreshSessions);
  const loadMcpRef = useRef(mcp.loadMcp);
  useEffect(() => {
    refreshSessionsRef.current = sessionsHook.refreshSessions;
    loadMcpRef.current = mcp.loadMcp;
  });

  const handleRefresh = useCallback(() => {
    void refreshSessionsRef.current();
    void loadMcpRef.current();
  }, []);

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
          showMcp={showMcp}
          onToggleMcp={() => setShowMcp((v) => !v)}
        />
      </section>

      <McpDrawer
        open={showMcp}
        skills={mcp.skills}
        builtinMcps={mcp.builtinMcps}
        mcps={mcp.mcps}
        isLoadingMcp={mcp.isLoadingMcp}
        error={mcpDetail.error}
        notice={mcpDetail.notice}
        onLoadMcp={() => void mcp.loadMcp()}
        onSelectMcp={(r) => void mcpDetail.loadMcpDetail(r)}
        onClose={() => setShowMcp(false)}
      />

      <McpDetailDrawer detail={mcpDetail} />
    </main>
  );
}
