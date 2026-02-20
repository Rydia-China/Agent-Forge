"use client";

import { Button, Input, Typography, Empty, Space } from "antd";
import { PlusOutlined, ReloadOutlined, DeleteOutlined } from "@ant-design/icons";
import { formatTimestamp } from "./client-utils";
import type { SessionSummary } from "../types";

export interface SessionSidebarProps {
  userDraft: string;
  setUserDraft: (v: string) => void;
  applyUserName: () => void;
  sessions: SessionSummary[];
  isLoadingSessions: boolean;
  refreshSessions: () => void;
  currentSessionId: string | undefined;
  switchSession: (sessionId?: string) => void;
  deleteSession: (sessionId: string) => void;
}

export function SessionSidebar({
  userDraft,
  setUserDraft,
  applyUserName,
  sessions,
  isLoadingSessions,
  refreshSessions,
  currentSessionId,
  switchSession,
  deleteSession,
}: SessionSidebarProps) {
  return (
    <aside className="flex h-full w-56 shrink-0 flex-col border-r border-slate-800 bg-slate-950/80 p-3">
      <div className="mb-3">
        <Typography.Title level={5} style={{ margin: 0 }}>Agent Forge</Typography.Title>
        <Typography.Text type="secondary" style={{ fontSize: 10 }}>Multi-agent console</Typography.Text>
      </div>

      <div className="mb-3">
        <Typography.Text type="secondary" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>
          User
        </Typography.Text>
        <Space.Compact size="small" block style={{ marginTop: 4 }}>
          <Input
            size="small"
            value={userDraft}
            onChange={(e) => setUserDraft(e.target.value)}
            onPressEnter={applyUserName}
            placeholder="default"
          />
          <Button size="small" onClick={applyUserName}>Go</Button>
        </Space.Compact>
      </div>

      <div className="mb-1.5 flex items-center justify-between">
        <Typography.Text type="secondary" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Sessions
        </Typography.Text>
        <Space size={4}>
          <Button type="text" size="small" icon={<PlusOutlined />} onClick={() => switchSession(undefined)} title="新会话" />
          <Button type="text" size="small" icon={<ReloadOutlined />} loading={isLoadingSessions} onClick={refreshSessions} />
        </Space>
      </div>

      <div className="flex-1 overflow-y-auto">
        {sessions.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No sessions." style={{ margin: "12px 0" }} />
        ) : (
          <div className="space-y-1">
            {sessions.map((s) => {
              const isActive = currentSessionId === s.id;
              return (
                <div key={s.id} className="group relative">
                  <button
                    className={`w-full rounded border px-2 py-1.5 text-left text-[11px] transition ${isActive ? "border-emerald-400/60 bg-emerald-500/10" : "border-slate-800 bg-slate-900/40 hover:border-slate-600"}`}
                    onClick={() => switchSession(s.id)}
                    type="button"
                  >
                    <div className="truncate pr-5 font-medium text-slate-100">
                      {s.title?.trim() || "Untitled"}
                    </div>
                    <div className="text-[10px] text-slate-400">
                      {formatTimestamp(s.updatedAt)}
                    </div>
                  </button>
                  <Button
                    type="text"
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    className="!absolute right-1 top-1.5 opacity-0 group-hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      void deleteSession(s.id);
                    }}
                    title="永久删除"
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}
