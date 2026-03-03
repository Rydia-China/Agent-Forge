"use client";

import { useState, useEffect, useCallback } from "react";
import { Button, Drawer, Input, Spin, Typography, App, Tag, Tooltip } from "antd";
import {
  ReloadOutlined,
  RollbackOutlined,
  SaveOutlined,
  CopyOutlined,
} from "@ant-design/icons";
import { fetchJson } from "@/app/components/client-utils";

/* ------------------------------------------------------------------ */
/*  Types (mirror backend service types)                               */
/* ------------------------------------------------------------------ */

interface VersionRow {
  id: string;
  version: number;
  prompt: string;
  url: string | null;
  refUrls: string[];
  createdAt: string;
}

interface ImageGenDetail {
  id: string;
  sessionId: string;
  key: string;
  currentVersion: number;
  prompt: string | null;
  url: string | null;
  versions: VersionRow[];
  createdAt: string;
  updatedAt: string;
}

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

export interface ImageDetailDrawerProps {
  /** The KeyResource id to display. null = closed. */
  imageGenId: string | null;
  onClose: () => void;
  /** Called after any mutation so parent can refresh. */
  onRefresh?: () => void;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function ImageDetailDrawer({ imageGenId, onClose, onRefresh }: ImageDetailDrawerProps) {
  const { message } = App.useApp();
  const [detail, setDetail] = useState<ImageGenDetail | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [editPrompt, setEditPrompt] = useState("");
  const [isSavingPrompt, setIsSavingPrompt] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [rollingBackVersion, setRollingBackVersion] = useState<number | null>(null);
  const [viewedVersion, setViewedVersion] = useState(0);

  /* ---- Fetch detail ---- */
  const fetchDetail = useCallback(async (id: string, silent = false) => {
    if (!silent) setIsLoading(true);
    try {
      const data = await fetchJson<ImageGenDetail>(`/api/key-resources/${id}`);
      setDetail(data);
      const curVer = data.versions.find((v) => v.version === data.currentVersion);
      setEditPrompt(curVer?.prompt ?? "");
      setViewedVersion(data.currentVersion);
    } catch {
      void message.error("Failed to load image detail");
    } finally {
      setIsLoading(false);
    }
  }, [message]);

  useEffect(() => {
    if (imageGenId) {
      void fetchDetail(imageGenId);
    } else {
      setDetail(null);
    }
  }, [imageGenId, fetchDetail]);

  /* ---- Derived state ---- */
  const viewedVerRow = detail?.versions.find((v) => v.version === viewedVersion) ?? null;
  const isViewingCurrent = !detail || viewedVersion === detail.currentVersion;
  const promptDirty = viewedVerRow != null && editPrompt !== viewedVerRow.prompt;

  /* ---- Save prompt ---- */
  const handleSavePrompt = useCallback(async () => {
    if (!detail || !promptDirty) return;
    setIsSavingPrompt(true);
    try {
      await fetchJson(`/api/key-resources/${detail.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: editPrompt }),
      });
      void message.success("Prompt saved");
      void fetchDetail(detail.id, true);
      onRefresh?.();
    } catch {
      void message.error("Failed to save prompt");
    } finally {
      setIsSavingPrompt(false);
    }
  }, [detail, editPrompt, promptDirty, fetchDetail, message, onRefresh]);

  /* ---- Regenerate ---- */
  const handleRegenerate = useCallback(async () => {
    if (!detail) return;
    setIsRegenerating(true);
    try {
      const promptOverride = promptDirty ? editPrompt : undefined;
      await fetchJson(`/api/key-resources/${detail.id}/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(promptOverride ? { prompt: promptOverride } : {}),
      });
      void message.success("Image regenerated");
      void fetchDetail(detail.id, true);
      onRefresh?.();
    } catch {
      void message.error("Regeneration failed");
    } finally {
      setIsRegenerating(false);
    }
  }, [detail, editPrompt, promptDirty, fetchDetail, message, onRefresh]);

  /* ---- Rollback ---- */
  const handleRollback = useCallback(async (version: number) => {
    if (!detail) return;
    setRollingBackVersion(version);
    try {
      await fetchJson(`/api/key-resources/${detail.id}/rollback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version }),
      });
      void message.success(`Rolled back to v${version}`);
      void fetchDetail(detail.id, true);
      onRefresh?.();
    } catch {
      void message.error("Rollback failed");
    } finally {
      setRollingBackVersion(null);
    }
  }, [detail, fetchDetail, message, onRefresh]);

  /* ---- Render ---- */
  return (
    <Drawer
      title={
        detail ? (
          <div className="flex items-center gap-2">
            <span className="truncate font-mono text-sm">{detail.key}</span>
            <Tag color="blue" style={{ fontSize: 10, lineHeight: "16px", margin: 0 }}>
              v{detail.currentVersion}
            </Tag>
            {!isViewingCurrent && (
              <Tag color="orange" style={{ fontSize: 10, lineHeight: "16px", margin: 0 }}>
                viewing v{viewedVersion}
              </Tag>
            )}
          </div>
        ) : "Image Detail"
      }
      open={!!imageGenId}
      onClose={onClose}
      styles={{ wrapper: { width: 720 } }}
      destroyOnClose
    >
      {isLoading || !detail ? (
        <div className="flex justify-center py-12"><Spin /></div>
      ) : (
        <div className="flex gap-5" style={{ height: "calc(100vh - 110px)" }}>
          {/* ── Left Column: Image + Version History ── */}
          <div className="flex w-1/2 flex-col gap-3">
            {/* Large Image */}
            <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg border border-slate-700 bg-slate-900/30">
              {viewedVerRow?.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={viewedVerRow.url}
                  alt={detail.key}
                  className="h-full w-full object-contain"
                />
              ) : (
                <span className="text-sm text-slate-500">No image yet</span>
              )}
            </div>

            {/* Version History — horizontal scroll, chronological L→R */}
            {detail.versions.length > 0 && (
              <div className="shrink-0">
                <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: "thin" }}>
                  {detail.versions.map((ver) => {
                    const isViewed = ver.version === viewedVersion;
                    const isCurrent = ver.version === detail.currentVersion;
                    return (
                      <div
                        key={ver.id}
                        className={`relative shrink-0 cursor-pointer overflow-hidden rounded-lg border-2 transition-colors ${
                          isViewed
                            ? "border-blue-500"
                            : "border-transparent hover:border-slate-600"
                        }`}
                        style={{ width: 56, height: 56 }}
                        onClick={() => {
                          setViewedVersion(ver.version);
                          setEditPrompt(ver.prompt);
                        }}
                      >
                        {ver.url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={ver.url}
                            alt={`v${ver.version}`}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center bg-slate-800 text-[10px] text-slate-500">
                            …
                          </div>
                        )}
                        <div className="absolute inset-x-0 bottom-0 bg-black/60 py-0.5 text-center text-[10px] font-medium text-white">
                          v{ver.version}{isCurrent ? " ✓" : ""}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* ── Right Column: Prompt + Actions ── */}
          <div className="flex w-1/2 flex-col gap-3">
            {/* Prompt header + copy */}
            <div className="flex items-center justify-between">
              <Typography.Text type="secondary" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Prompt
              </Typography.Text>
              <Tooltip title="Copy prompt">
                <Button
                  size="small"
                  type="text"
                  icon={<CopyOutlined />}
                  onClick={() => {
                    void navigator.clipboard.writeText(editPrompt);
                    void message.success("Copied");
                  }}
                />
              </Tooltip>
            </div>

            {/* Prompt textarea — fills available space */}
            <div className="min-h-0 flex-1 overflow-y-auto">
              <Input.TextArea
                value={editPrompt}
                onChange={(e) => setEditPrompt(e.target.value)}
                autoSize={{ minRows: 6, maxRows: 24 }}
                style={{ fontSize: 12 }}
              />
            </div>

            {/* Action buttons */}
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button
                size="small"
                icon={<SaveOutlined />}
                onClick={() => void handleSavePrompt()}
                loading={isSavingPrompt}
                disabled={!promptDirty}
              >
                Save Prompt
              </Button>
              <Button
                type="primary"
                size="small"
                icon={<ReloadOutlined />}
                onClick={() => void handleRegenerate()}
                loading={isRegenerating}
              >
                {promptDirty ? "Save & Regenerate" : "Regenerate"}
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
