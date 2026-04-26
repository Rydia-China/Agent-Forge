"use client";

import { useCallback, useState } from "react";
import { Button, Typography, Empty, Tag, Modal, Spin } from "antd";
import {
  ReloadOutlined,
  PlusOutlined,
  DeleteOutlined,
  EyeOutlined,
} from "@ant-design/icons";
import { fetchJson } from "@/app/components/client-utils";
import type { EpisodeSummary, EpStatus } from "../types";
import type { SessionSummary } from "@/app/types";

/* ------------------------------------------------------------------ */
/*  Status badge                                                       */
/* ------------------------------------------------------------------ */

const STATUS_CONFIG: Record<EpStatus, { color: string; label: string }> = {
  empty: { color: "default", label: "empty" },
  uploaded: { color: "blue", label: "uploaded" },
  has_resources: { color: "green", label: "active" },
};

function EpStatusTag({ status }: { status: EpStatus }) {
  const cfg = STATUS_CONFIG[status];
  return <Tag color={cfg.color} style={{ fontSize: 10, lineHeight: "16px", margin: 0 }}>{cfg.label}</Tag>;
}

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

export interface EpisodeListProps {
  novelName: string;
  episodes: EpisodeSummary[];
  isLoading: boolean;
  selectedEpisode: EpisodeSummary | null;
  onSelectEpisode: (ep: EpisodeSummary) => void;
  onDeleteEpisode: (ep: EpisodeSummary) => void;
  onRefresh: () => void;
  sessions: SessionSummary[];
  currentSessionId: string | undefined;
  onSelectSession: (sessionId: string) => void;
  onNewSession: () => void;
  onDeleteSession: (sessionId: string) => void;
  isNovelLevelSelected: boolean;
  onSelectNovelLevel: () => void;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function EpisodeList({
  novelName,
  episodes,
  isLoading,
  selectedEpisode,
  onSelectEpisode,
  onDeleteEpisode,
  onRefresh,
  sessions,
  currentSessionId,
  onSelectSession,
  onNewSession,
  onDeleteSession,
  isNovelLevelSelected,
  onSelectNovelLevel,
}: EpisodeListProps) {
  const [jsonViewEp, setJsonViewEp] = useState<EpisodeSummary | null>(null);
  const [jsonContent, setJsonContent] = useState<unknown>(null);
  const [jsonLoading, setJsonLoading] = useState(false);

  const openJsonView = useCallback(async (ep: EpisodeSummary) => {
    setJsonViewEp(ep);
    setJsonContent(null);
    setJsonLoading(true);
    try {
      setJsonContent(
        await fetchJson<unknown>(
          `/api/video/episodes/${encodeURIComponent(ep.id)}/output`,
        ),
      );
    } catch {
      setJsonContent({ error: "Failed to load episode output" });
    } finally {
      setJsonLoading(false);
    }
  }, []);

  const sortedEpisodes = [...episodes].sort((a, b) =>
    a.scriptKey.localeCompare(b.scriptKey, undefined, { numeric: true }),
  );

  const renderSessions = (accent: "purple" | "emerald") => (
    <div className={`ml-2.5 mb-1 mt-1 border-l-2 pl-2 ${accent === "purple" ? "border-purple-500/40" : "border-emerald-500/40"}`}>
      <div className="mb-1 flex items-center justify-between">
        <Typography.Text type="secondary" style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Sessions
        </Typography.Text>
        <Button type="text" size="small" icon={<PlusOutlined />} onClick={onNewSession} title="New Chat" style={{ width: 18, height: 18, minWidth: 18 }} />
      </div>
      {sessions.length === 0 ? (
        <div className="py-1 text-center text-[9px] text-slate-500">
          No sessions. Click + to start.
        </div>
      ) : (
        <div className="space-y-0.5">
          {sessions.map((s) => {
            const isCurrent = currentSessionId === s.id;
            return (
              <div key={s.id} className="group/s relative">
                <button
                  type="button"
                  className={`w-full rounded px-2 py-1 text-left text-[10px] transition ${
                    isCurrent
                      ? accent === "purple" ? "bg-purple-500/15 text-purple-200" : "bg-emerald-500/15 text-emerald-200"
                      : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
                  }`}
                  onClick={() => onSelectSession(s.id)}
                >
                  <div className="truncate pr-5">
                    {s.title?.trim() || "Untitled"}
                  </div>
                </button>
                <Button
                  type="text"
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  className="!absolute right-0 top-0.5 opacity-0 group-hover/s:opacity-100"
                  onClick={(e) => { e.stopPropagation(); onDeleteSession(s.id); }}
                  style={{ width: 18, height: 18, minWidth: 18 }}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  return (
    <aside className="flex h-full w-52 shrink-0 flex-col border-r border-slate-800 bg-slate-950/80">
      <div className="border-b border-slate-800 p-3">
        <Typography.Text strong ellipsis style={{ display: "block", fontSize: 13 }}>
          {novelName}
        </Typography.Text>
      </div>

      <div className="border-b border-slate-700 p-2">
        <button
          type="button"
          className={`w-full rounded border px-2.5 py-2 text-left transition ${
            isNovelLevelSelected
              ? "border-purple-400/60 bg-purple-500/10"
              : "border-slate-800 bg-slate-900/40 hover:border-slate-600"
          }`}
          onClick={onSelectNovelLevel}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-100">小说资源</span>
            <Tag color="purple" style={{ fontSize: 10, lineHeight: "16px", margin: 0 }}>novel</Tag>
          </div>
          <div className="mt-0.5 text-[10px] text-slate-400">角色 · 场景</div>
        </button>
        {isNovelLevelSelected && renderSessions("purple")}
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        <div className="mb-1 flex items-center justify-between">
          <Typography.Text type="secondary" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Episodes
          </Typography.Text>
          <Button type="text" size="small" icon={<ReloadOutlined />} loading={isLoading} onClick={onRefresh} />
        </div>

        {sortedEpisodes.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No episodes" style={{ margin: "12px 0" }} />
        ) : (
          <div className="space-y-1">
            {sortedEpisodes.map((ep) => {
              const isActive = !isNovelLevelSelected && selectedEpisode?.id === ep.id;
              return (
                <div key={ep.id}>
                  <div className="group relative">
                    <button
                      type="button"
                      className={`w-full rounded border px-2.5 py-2 text-left transition ${
                        isActive
                          ? "border-blue-400/60 bg-blue-500/10"
                          : "border-slate-800 bg-slate-900/40 hover:border-slate-600"
                      }`}
                      onClick={() => onSelectEpisode(ep)}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-slate-100">
                          {ep.scriptKey}
                        </span>
                        <EpStatusTag status={ep.status} />
                      </div>
                      {ep.scriptName && (
                        <div className="mt-0.5 truncate text-[10px] text-slate-400">
                          {ep.scriptName}
                        </div>
                      )}
                    </button>
                    <div className="!absolute right-0.5 top-0.5 flex gap-0.5 opacity-0 group-hover:opacity-100">
                      <Button
                        type="text"
                        size="small"
                        icon={<EyeOutlined />}
                        onClick={(e) => { e.stopPropagation(); void openJsonView(ep); }}
                        style={{ width: 20, height: 20, minWidth: 20 }}
                        title="View JSON"
                      />
                      <Button
                        type="text"
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={(e) => { e.stopPropagation(); onDeleteEpisode(ep); }}
                        style={{ width: 20, height: 20, minWidth: 20 }}
                      />
                    </div>
                  </div>

                  {isActive && renderSessions("emerald")}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Modal
        title={`Episode: ${jsonViewEp?.scriptKey ?? ""}`}
        open={!!jsonViewEp}
        onCancel={() => { setJsonViewEp(null); setJsonContent(null); }}
        footer={null}
        width={600}
      >
        {jsonLoading ? (
          <div className="flex justify-center py-8"><Spin /></div>
        ) : (
          <pre className="max-h-[60vh] overflow-auto rounded bg-slate-900 p-3 text-xs text-slate-200">
            {jsonContent ? JSON.stringify(jsonContent, null, 2) : ""}
          </pre>
        )}
      </Modal>
    </aside>
  );
}
