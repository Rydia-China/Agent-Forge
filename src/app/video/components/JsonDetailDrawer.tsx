"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { App, Button, Drawer, Input, Spin, Tag, Tooltip, Typography } from "antd";
import {
  CopyOutlined,
  CloseOutlined,
  RollbackOutlined,
  SaveOutlined,
} from "@ant-design/icons";
import { fetchJson } from "@/app/components/client-utils";

interface VersionRow {
  id: string;
  version: number;
  title: string | null;
  data: unknown;
  prompt: string | null;
  createdAt: string;
}

interface KeyResourceDetail {
  id: string;
  key: string;
  mediaType: string;
  currentVersion: number;
  data: unknown;
  prompt: string | null;
  versions: VersionRow[];
  createdAt: string;
  updatedAt: string;
}

export interface JsonDetailDrawerProps {
  keyResourceId: string | null;
  onClose: () => void;
  onRefresh?: () => void;
  sessionId?: string;
}

function formatJson(data: unknown): string {
  return JSON.stringify(data ?? null, null, 2);
}

export function JsonDetailDrawer({ keyResourceId, onClose, onRefresh, sessionId }: JsonDetailDrawerProps) {
  const { message } = App.useApp();
  const [detail, setDetail] = useState<KeyResourceDetail | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [editText, setEditText] = useState("");
  const [isSavingData, setIsSavingData] = useState(false);
  const [rollingBackVersion, setRollingBackVersion] = useState<number | null>(null);
  const [deletingVersion, setDeletingVersion] = useState<number | null>(null);
  const [viewedVersion, setViewedVersion] = useState(0);

  const fetchDetail = useCallback(async (id: string, silent = false) => {
    if (!silent) setIsLoading(true);
    try {
      const data = await fetchJson<KeyResourceDetail>(`/api/key-resources/${id}`);
      setDetail(data);
      const curVer = data.versions.find((v) => v.version === data.currentVersion);
      setEditText(formatJson(curVer?.data ?? data.data));
      setViewedVersion(data.currentVersion);
    } catch {
      void message.error("Failed to load JSON detail");
    } finally {
      setIsLoading(false);
    }
  }, [message]);

  useEffect(() => {
    if (keyResourceId) {
      void fetchDetail(keyResourceId);
    } else {
      setDetail(null);
    }
  }, [keyResourceId, fetchDetail]);

  const viewedVerRow = detail?.versions.find((v) => v.version === viewedVersion) ?? null;
  const isViewingCurrent = !detail || viewedVersion === detail.currentVersion;
  const originalJson = viewedVerRow ? formatJson(viewedVerRow.data) : "";
  const dataDirty = viewedVerRow != null && editText !== originalJson;

  const parsedPreview = useMemo(() => {
    try {
      return { ok: true as const, data: JSON.parse(editText) as unknown };
    } catch (error: unknown) {
      return {
        ok: false as const,
        error: error instanceof Error ? error.message : "Invalid JSON",
      };
    }
  }, [editText]);

  const handleSaveData = useCallback(async () => {
    if (!detail || !dataDirty || !parsedPreview.ok) return;
    setIsSavingData(true);
    try {
      await fetchJson(`/api/key-resources/${detail.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: parsedPreview.data }),
      });
      void message.success("JSON saved as a new version");
      void fetchDetail(detail.id, true);
      onRefresh?.();
    } catch {
      void message.error("Failed to save JSON");
    } finally {
      setIsSavingData(false);
    }
  }, [dataDirty, detail, fetchDetail, message, onRefresh, parsedPreview]);

  const handleDeleteVersion = useCallback(async (version: number) => {
    if (!detail || detail.versions.length <= 1) return;
    setDeletingVersion(version);
    try {
      await fetchJson(`/api/key-resources/${detail.id}/versions/${version}`, { method: "DELETE" });
      void message.success(`Deleted v${version}`);
      void fetchDetail(detail.id, true);
      onRefresh?.();
    } catch {
      void message.error("Failed to delete version");
    } finally {
      setDeletingVersion(null);
    }
  }, [detail, fetchDetail, message, onRefresh]);

  const handleRollback = useCallback(async (version: number) => {
    if (!detail) return;
    setRollingBackVersion(version);
    try {
      await fetchJson(`/api/key-resources/${detail.id}/rollback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version, ...(sessionId ? { session_id: sessionId } : {}) }),
      });
      void message.success(`Rolled back to v${version}`);
      void fetchDetail(detail.id, true);
      onRefresh?.();
    } catch {
      void message.error("Rollback failed");
    } finally {
      setRollingBackVersion(null);
    }
  }, [detail, fetchDetail, message, onRefresh, sessionId]);

  return (
    <Drawer
      title={
        detail ? (
          <div className="flex items-center gap-2">
            <span className="truncate font-mono text-sm">{detail.key}</span>
            <Tag color="blue" style={{ fontSize: 14, lineHeight: "22px", margin: 0 }}>
              v{detail.currentVersion}
            </Tag>
            {!isViewingCurrent && (
              <Tag color="orange" style={{ fontSize: 14, lineHeight: "22px", margin: 0 }}>
                viewing v{viewedVersion}
              </Tag>
            )}
          </div>
        ) : "JSON Detail"
      }
      open={!!keyResourceId}
      onClose={onClose}
      styles={{ wrapper: { width: 900 } }}
      destroyOnClose
    >
      {isLoading || !detail ? (
        <div className="flex justify-center py-12"><Spin /></div>
      ) : (
        <div className="flex gap-5" style={{ height: "calc(100vh - 110px)" }}>
          <div className="flex w-[42%] flex-col gap-3">
            <div className="flex items-center justify-between">
              <Typography.Text type="secondary" style={{ fontSize: 14, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Preview
              </Typography.Text>
              <Tooltip title="Copy JSON">
                <Button
                  size="small"
                  type="text"
                  icon={<CopyOutlined />}
                  onClick={() => {
                    void navigator.clipboard.writeText(editText);
                    void message.success("Copied");
                  }}
                />
              </Tooltip>
            </div>

            <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-slate-700 bg-slate-900/30 p-3">
              {parsedPreview.ok ? (
                <pre className="whitespace-pre-wrap break-all font-mono text-sm leading-relaxed text-slate-300">
                  {formatJson(parsedPreview.data)}
                </pre>
              ) : (
                <div className="space-y-2">
                  <Typography.Text type="danger">Invalid JSON: {parsedPreview.error}</Typography.Text>
                  <pre className="whitespace-pre-wrap break-all font-mono text-sm leading-relaxed text-slate-500">
                    {editText}
                  </pre>
                </div>
              )}
            </div>

            {detail.versions.length > 0 && (
              <div className="shrink-0">
                <div className="mb-1 text-xs uppercase tracking-wide text-slate-500">Versions</div>
                <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: "thin" }}>
                  {detail.versions.map((ver) => {
                    const isViewed = ver.version === viewedVersion;
                    const isCurrent = ver.version === detail.currentVersion;
                    return (
                      <div key={ver.id} className="group relative shrink-0">
                        <button
                          type="button"
                          className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                            isViewed
                              ? "border-blue-500 bg-blue-500/10"
                              : "border-slate-700 bg-slate-900/50 hover:border-slate-500"
                          }`}
                          onClick={() => {
                            setViewedVersion(ver.version);
                            setEditText(formatJson(ver.data));
                          }}
                        >
                          <div className="text-sm font-medium text-white">
                            v{ver.version}{isCurrent ? " ✓" : ""}
                          </div>
                          <div className="text-xs text-slate-400">JSON</div>
                        </button>
                        {detail.versions.length > 1 && (
                          <button
                            type="button"
                            className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-slate-700 text-white opacity-0 transition-opacity hover:bg-red-600 group-hover:opacity-100"
                            style={{ fontSize: 8, lineHeight: 1 }}
                            onClick={() => void handleDeleteVersion(ver.version)}
                          >
                            {deletingVersion === ver.version ? "…" : <CloseOutlined style={{ fontSize: 8 }} />}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <Typography.Text type="secondary" style={{ fontSize: 14, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              JSON Editor
            </Typography.Text>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <Input.TextArea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                autoSize={{ minRows: 16, maxRows: 28 }}
                style={{ fontFamily: "monospace", fontSize: 14 }}
              />
            </div>

            <div className="flex shrink-0 flex-wrap gap-2">
              <Button
                size="small"
                icon={<SaveOutlined />}
                onClick={() => void handleSaveData()}
                loading={isSavingData}
                disabled={!dataDirty || !parsedPreview.ok}
              >
                Save JSON
              </Button>
              {!isViewingCurrent && (
                <Button
                  size="small"
                  icon={<RollbackOutlined />}
                  onClick={() => void handleRollback(viewedVersion)}
                  loading={rollingBackVersion === viewedVersion}
                >
                  Rollback to v{viewedVersion}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </Drawer>
  );
}
