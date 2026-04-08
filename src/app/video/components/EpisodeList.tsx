"use client";

import { useCallback, useRef, useState } from "react";
import { Button, Typography, Empty, Tag, Modal, Spin } from "antd";
import {
  ReloadOutlined,
  PlusOutlined,
  DeleteOutlined,
  EyeOutlined,
  LoadingOutlined,
  ExclamationCircleFilled,
  UploadOutlined,
} from "@ant-design/icons";
import { fetchJson } from "@/app/components/client-utils";
import type { EpisodeSummary, EpStatus } from "../types";
import type { SessionSummary } from "@/app/types";
import type { EpTaskStatus } from "../hooks/useTaskMonitor";

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
  return <Tag color={cfg.color} style={{ fontSize: 14, lineHeight: "22px", margin: 0 }}>{cfg.label}</Tag>;
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
  onRefresh: () => void;
  /** Re-upload script JSON for this novel. */
  onReUpload: (jsonData: unknown) => void;
  isReUploading?: boolean;
  /** Sessions for the currently selected EP or novel-level. */
  sessions: SessionSummary[];
  currentSessionId: string | undefined;
  onSelectSession: (sessionId: string) => void;
  onNewSession: () => void;
  onDeleteSession: (sessionId: string) => void;
  /** Whether novel-level (not EP-level) is selected. */
  isNovelLevelSelected: boolean;
  /** Callback when user selects novel-level resource management. */
  onSelectNovelLevel: () => void;
  /** Per-EP task status from useTaskMonitor. */
  epTaskStatuses?: Map<string, EpTaskStatus>;
  /** Callback to enter prompt management mode. */
  onEnterPrompts?: () => void;
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
  onRefresh,
  onReUpload,
  isReUploading,
  sessions,
  currentSessionId,
  onSelectSession,
  onNewSession,
  onDeleteSession,
  isNovelLevelSelected,
  onSelectNovelLevel,
  epTaskStatuses,
  onEnterPrompts,
}: EpisodeListProps) {
  const reUploadRef = useRef<HTMLInputElement>(null);
  const [jsonViewEp, setJsonViewEp] = useState<EpisodeSummary | null>(null);
  const [jsonContent, setJsonContent] = useState<unknown>(null);
  const [jsonLoading, setJsonLoading] = useState(false);

  const handleReUploadFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith(".json")) {
      alert("Only .json files are accepted");
      e.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const jsonData = JSON.parse(reader.result as string) as unknown;
        onReUpload(jsonData);
      } catch {
        alert("Invalid JSON file");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }, [onReUpload]);

  const openJsonView = useCallback(async (ep: EpisodeSummary) => {
    setJsonViewEp(ep);
    setJsonContent(null);
    setJsonLoading(true);
    try {
      const data = await fetchJson<unknown>(
        `/api/video/episodes/${encodeURIComponent(ep.id)}/output`,
      );
      setJsonContent(data);
    } catch {
      setJsonContent({ error: "Failed to load episode output" });
    } finally {
      setJsonLoading(false);
    }
  }, []);

  const sortedEpisodes = [...episodes].sort((a, b) =>
    a.scriptKey.localeCompare(b.scriptKey, undefined, { numeric: true }),
  );

  return (
    <aside className="flex h-full w-52 shrink-0 flex-col border-r border-slate-800 bg-slate-950/80">
      {/* Header */}
      <div className="border-b border-slate-800 p-3">
        <div className="flex items-center justify-between">
          <Typography.Text strong ellipsis style={{ display: "block", fontSize: 18 }}>
            {novelName}
          </Typography.Text>
          <Button
            type="text"
            size="small"
            icon={<UploadOutlined />}
            loading={isReUploading}
            onClick={() => reUploadRef.current?.click()}
            title="重传剧本数据"
            style={{ width: 28, height: 28, minWidth: 28 }}
          />
        </div>
        <input
          ref={reUploadRef}
          type="file"
          accept=".json"
          onChange={handleReUploadFile}
          style={{ display: "none" }}
        />
      </div>

      {/* Prompt management entry */}
      {onEnterPrompts && (
        <div className="border-b border-slate-700 p-2">
          <button
            type="button"
            className="w-full rounded border border-slate-800 bg-slate-900/40 px-2.5 py-2 text-left transition hover:border-amber-400/40 hover:bg-amber-500/5"
            onClick={onEnterPrompts}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-100">📝 Prompt 管理</span>
            </div>
            <div className="mt-0.5 text-sm text-slate-400">Langfuse 模板</div>
          </button>
        </div>
      )}

      {/* Novel-level resource management */}
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
            <span className="text-sm font-medium text-slate-100">📚 小说资源</span>
            <Tag color="purple" style={{ fontSize: 14, lineHeight: "22px", margin: 0 }}>novel</Tag>
          </div>
          <div className="mt-0.5 text-sm text-slate-400">角色 · 场景</div>
        </button>

        {/* Novel-level sessions */}
        {isNovelLevelSelected && (
          <div className="ml-2.5 mt-1 mb-1 border-l-2 border-purple-500/40 pl-2">
            <div className="mb-1 flex items-center justify-between">
              <Typography.Text type="secondary" style={{ fontSize: 14, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Sessions
              </Typography.Text>
              <Button type="text" size="small" icon={<PlusOutlined />} onClick={onNewSession} title="New Chat" style={{ width: 28, height: 28, minWidth: 28 }} />
            </div>
            {sessions.length === 0 ? (
              <div className="py-1 text-center text-sm text-slate-500">
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
                        className={`w-full rounded px-2 py-1 text-left text-sm transition ${
                          isCurrent
                            ? "bg-purple-500/15 text-purple-200"
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
                        style={{ width: 28, height: 28, minWidth: 28 }}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Episodes */}
      <div className="flex-1 overflow-y-auto p-2">
        <div className="mb-1 flex items-center justify-between">
          <Typography.Text type="secondary" style={{ fontSize: 14, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Episodes
          </Typography.Text>
          <Button type="text" size="small" icon={<ReloadOutlined />} loading={isLoading} onClick={onRefresh} />
        </div>

        {sortedEpisodes.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No episodes" style={{ margin: "12px 0" }} />
        ) : (
          <div className="space-y-1">
            {sortedEpisodes.map((ep) => {
              const isActive = selectedEpisode?.id === ep.id && !isNovelLevelSelected;
              return (
                <div key={ep.id}>
                  {/* Episode card */}
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
                        <span className="text-sm font-medium text-slate-100">
                          {ep.scriptKey}
                        </span>
                        <div className="flex items-center gap-1">
                          {(() => {
                            const epTask = epTaskStatuses?.get(ep.scriptKey);
                            if (!epTask) return null;
                            if (epTask.status === "running") return <LoadingOutlined className="text-blue-400" spin style={{ fontSize: 28 }} />;
                            if (epTask.status === "queued") return <LoadingOutlined className="text-slate-400" style={{ fontSize: 28 }} />;
                            if (epTask.status === "failed") return <ExclamationCircleFilled className="text-red-400" style={{ fontSize: 28 }} />;
                            return null;
                          })()}
                          <EpStatusTag status={ep.status} />
                        </div>
                      </div>
                      {ep.scriptName && (
                        <div className="mt-0.5 truncate text-sm text-slate-400">
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
                        style={{ width: 28, height: 28, minWidth: 28 }}
                        title="View JSON"
                      />
                    </div>
                  </div>

                  {/* Sessions — inline under active EP */}
                  {isActive && (
                    <div className="ml-2.5 mt-1 mb-1 border-l-2 border-emerald-500/40 pl-2">
                      <div className="mb-1 flex items-center justify-between">
                        <Typography.Text type="secondary" style={{ fontSize: 14, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                          Sessions
                        </Typography.Text>
                        <Button type="text" size="small" icon={<PlusOutlined />} onClick={onNewSession} title="New Chat" style={{ width: 28, height: 28, minWidth: 28 }} />
                      </div>
                      {sessions.length === 0 ? (
                        <div className="py-1 text-center text-sm text-slate-500">
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
                                  className={`w-full rounded px-2 py-1 text-left text-sm transition ${
                                    isCurrent
                                      ? "bg-emerald-500/15 text-emerald-200"
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
                                  style={{ width: 28, height: 28, minWidth: 28 }}
                                />
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {/* JSON viewer modal */}
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
