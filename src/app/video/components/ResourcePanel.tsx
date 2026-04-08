"use client";

import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import { Button, Collapse, Drawer, Empty, Input, Spin, Typography, Image, Tag, App } from "antd";
import { DeleteOutlined, DownloadOutlined, EditOutlined, EyeOutlined, FormatPainterOutlined } from "@ant-design/icons";
import type { ResourceData, ResourceItem } from "../types";
import { fetchJson } from "@/app/components/client-utils";
import { ImageDetailDrawer } from "./ImageDetailDrawer";
import { VideoDetailDrawer } from "./VideoDetailDrawer";
import { StylePresetDrawer } from "./StylePresetDrawer";
import { PromptPreviewDrawer } from "./PromptPreviewDrawer";

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

export interface ResourcePanelProps {
  resources: ResourceData | null;
  isLoading: boolean;
  novelId: string;
  scriptId: string | null;
  sessionId: string | undefined;
  isNovelLevel?: boolean;
  onRefresh?: () => void;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

const ASIDE_CLASS = "flex h-full w-56 min-w-[200px] shrink-0 flex-col border-l border-slate-800 bg-slate-950/80";

export function ResourcePanel({ resources, isLoading, novelId, scriptId, sessionId, isNovelLevel, onRefresh }: ResourcePanelProps) {
  const { message } = App.useApp();

  /* ---- Export state ---- */
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = useCallback(async () => {
    setIsExporting(true);
    try {
      const url = scriptId
        ? `/api/video/episodes/${encodeURIComponent(scriptId)}/resources/export?novelId=${encodeURIComponent(novelId)}`
        : `/api/video/novel/${encodeURIComponent(novelId)}/resources/export`;
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`Export failed: ${resp.status}`);
      const blob = await resp.blob();
      const disposition = resp.headers.get("Content-Disposition");
      const match = disposition?.match(/filename="?([^"]+)"?/);
      const filename = match?.[1] ? decodeURIComponent(match[1]) : "resources.zip";
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
      void message.success("导出完成");
    } catch {
      void message.error("导出失败");
    } finally {
      setIsExporting(false);
    }
  }, [scriptId, novelId, message]);

  /* ---- JSON editor drawer state ---- */
  const [editingItem, setEditingItem] = useState<{ id: string; title: string; data: unknown } | null>(null);
  const [editText, setEditText] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  /* ---- Image detail drawer state ---- */
  const [selectedImageGenId, setSelectedImageGenId] = useState<string | null>(null);

  /* ---- Video detail drawer state ---- */
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);

  /* ---- Style preset drawer state ---- */
  const [styleDrawerOpen, setStyleDrawerOpen] = useState(false);

  /* ---- Prompt preview drawer state ---- */
  const [promptPreviewOpen, setPromptPreviewOpen] = useState(false);

  /* ---- Collapse expand state (controlled) ---- */
  const [activeKeys, setActiveKeys] = useState<string[]>([]);
  const knownKeysRef = useRef<Set<string>>(new Set());

  /* ---- Smart image rendering ---- */
  const renderSmartImage = (url: string, alt: string, resourceId: string) => {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={alt}
        className="w-full cursor-pointer"
        style={{ display: "block" }}
        onClick={() => setSelectedImageGenId(resourceId)}
      />
    );
  };

  /* ---- Delete handler ---- */
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());

  const handleDelete = useCallback(async (id: string) => {
    if (!scriptId) return;
    setDeletingIds((prev) => new Set(prev).add(id));
    try {
      await fetchJson(`/api/video/episodes/${encodeURIComponent(scriptId)}/resources`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resourceId: id }),
      });
      void message.success("Deleted");
      onRefresh?.();
    } catch {
      void message.error("Delete failed");
    } finally {
      setDeletingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }, [scriptId, onRefresh]);

  /* ---- JSON editor ---- */
  const openEditor = useCallback((item: { id: string; title: string; data: unknown }) => {
    setEditingItem(item);
    setEditText(item.data != null ? JSON.stringify(item.data, null, 2) : "");
  }, []);

  const handleSave = useCallback(async () => {
    if (!editingItem || !scriptId) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(editText);
    } catch {
      void message.error("Invalid JSON");
      return;
    }
    setIsSaving(true);
    try {
      await fetchJson(`/api/video/episodes/${encodeURIComponent(scriptId)}/resources`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resourceId: editingItem.id, data: parsed }),
      });
      void message.success("Saved");
      setEditingItem(null);
      onRefresh?.();
    } catch {
      void message.error("Save failed");
    } finally {
      setIsSaving(false);
    }
  }, [editingItem, editText, scriptId, onRefresh]);

  /* ---- Scene hierarchy grouping ---- */

  interface SceneGroup {
    parentTitle: string;
    gridItem: ResourceItem | null;
    subItems: ResourceItem[];
  }

  const groupSceneItems = useCallback((items: ResourceItem[]): { groups: SceneGroup[]; standalones: ResourceItem[] } => {
    // Find grid items (key ends with _grid)
    const gridItems = items.filter((r) => r.key.endsWith("_grid"));
    const usedIds = new Set<string>();
    const groups: SceneGroup[] = [];

    for (const gi of gridItems) {
      usedIds.add(gi.id);
      const baseTitle = (gi.title ?? "").replace(/\s*\(grid\)\s*$/, "");
      if (!baseTitle) continue;

      // Sub-items: title starts with baseTitle + " " (e.g. "银月领地 豪宅 厨房")
      const subItems = items.filter((r) =>
        !r.key.endsWith("_grid") &&
        r.title != null &&
        r.title !== baseTitle &&
        r.title.startsWith(baseTitle + " "),
      );
      for (const s of subItems) usedIds.add(s.id);

      // Parent's own single entry (same title, no _grid suffix)
      const parentSingle = items.find((r) => r.title === baseTitle && !r.key.endsWith("_grid"));
      if (parentSingle) usedIds.add(parentSingle.id);

      groups.push({ parentTitle: baseTitle, gridItem: gi, subItems });
    }

    const standalones = items.filter((r) => !usedIds.has(r.id));
    return { groups, standalones };
  }, []);

  /* ---- Per media_type renderers ---- */

  /* ---- Delete overlay button (shared across media types) ---- */
  const renderDeleteBtn = (id: string) => (
    <Button
      type="text"
      size="small"
      danger
      icon={<DeleteOutlined />}
      loading={deletingIds.has(id)}
      className="!absolute right-1 top-1 z-10 opacity-0 transition-opacity group-hover/card:opacity-100 !bg-black/60 !text-red-400 hover:!text-red-300"
      onClick={(e) => { e.stopPropagation(); void handleDelete(id); }}
      style={{ fontSize: 10, width: 22, height: 22, minWidth: 22 }}
    />
  );

  const renderImageItem = (r: ResourceItem) => (
    <div key={r.id} className="group/card relative overflow-hidden rounded-lg">
      {renderDeleteBtn(r.id)}
      {r.url ? (
        renderSmartImage(r.url, r.title ?? "Image", r.id)
      ) : (
        <div
          className="flex aspect-square cursor-pointer items-center justify-center bg-slate-800"
          onClick={() => setSelectedImageGenId(r.id)}
        >
          <span className="text-xs text-slate-500">{r.title ?? "待生成"}</span>
        </div>
      )}
      {r.title && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 pb-1.5 pt-5">
          <div className="truncate text-center text-[11px] font-medium text-white">{r.title}</div>
        </div>
      )}
    </div>
  );

  const renderVideoItem = (r: ResourceItem) => {
    return (
      <div key={r.id} className="group/card relative cursor-pointer overflow-hidden rounded-lg" onClick={() => setSelectedVideoId(r.id)}>
        {renderDeleteBtn(r.id)}
        {r.url ? (
          <video
            src={r.url}
            muted
            preload="metadata"
            playsInline
            className="aspect-[9/16] w-full object-cover"
            style={{ pointerEvents: "none" }}
          />
        ) : (
          <div className="flex aspect-[9/16] flex-col items-center justify-center bg-slate-800 px-2">
            <span className="mb-1 text-[10px] font-medium text-amber-400">待生成</span>
            {r.prompt ? (
              <p className="line-clamp-4 text-center text-[10px] leading-relaxed text-slate-500">
                {r.prompt}
              </p>
            ) : (
              <span className="text-xs text-slate-600">{r.title ?? r.key}</span>
            )}
          </div>
        )}
        {r.title && (
          <div className="px-2 py-1 text-center text-[11px] text-slate-400">{r.title}</div>
        )}
      </div>
    );
  };

  const renderJsonItem = (r: ResourceItem) => (
    <div
      key={r.id}
      className="group/card relative overflow-hidden rounded-lg bg-slate-900"
    >
      {renderDeleteBtn(r.id)}
      <pre className="max-h-32 overflow-hidden whitespace-pre-wrap break-all px-2 pt-2 pb-8 font-mono text-[9px] leading-relaxed text-slate-400">
        {r.prompt ?? ""}
      </pre>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/50 to-transparent px-2 pb-1.5 pt-6">
        <div className="truncate text-[11px] font-medium text-white">{r.title ?? r.key}</div>
      </div>
    </div>
  );

  /* ---- Auto-expand newly appeared categories, preserve existing expand state ---- */
  const categories = resources?.categories ?? [];
  const categoryKeys = useMemo(() => categories.map((g) => `cat-${g.category}`), [categories]);
  useEffect(() => {
    const newKeys = categoryKeys.filter((k) => !knownKeysRef.current.has(k));
    if (newKeys.length > 0) {
      for (const k of newKeys) knownKeysRef.current.add(k);
      setActiveKeys((prev) => [...prev, ...newKeys]);
    }
  }, [categoryKeys]);

  /* ---- Main render ---- */

  if (isLoading) {
    return (
      <aside className={ASIDE_CLASS}>
        <div className="flex flex-1 items-center justify-center"><Spin size="small" /></div>
      </aside>
    );
  }

  if (!resources) {
    return (
      <aside className={ASIDE_CLASS}>
        <div className="flex flex-1 items-center justify-center text-xs text-slate-500">
          Select an episode
        </div>
      </aside>
    );
  }

  const collapseItems = categories.map((g) => {
    const isVideoUrl = (url: string | null) => /\.(?:mp4|webm|mov)(?:[?#]|$)/i.test(url ?? "");
    const images = g.items.filter((r) => r.mediaType === "image" && !isVideoUrl(r.url));
    const videos = g.items.filter((r) => r.mediaType === "video" || (r.mediaType === "image" && isVideoUrl(r.url)));
    const jsons = g.items.filter((r) => r.mediaType === "json");

    // Scene category: hierarchical rendering (grid parent → sub-scenes)
    const isSceneCategory = g.category === "场景";
    const sceneGrouped = isSceneCategory ? groupSceneItems(images) : null;

    return {
      key: `cat-${g.category}`,
      label: (
        <span className="flex items-center gap-1.5 text-xs font-medium">
          {g.category}
          <Tag style={{ fontSize: 10, lineHeight: "16px", margin: 0 }}>{g.items.length}</Tag>
        </span>
      ),
      children: (
        <div className="space-y-2">
          {isSceneCategory && sceneGrouped ? (
            <div className="space-y-3">
              {/* Grid parents with sub-scenes */}
              {sceneGrouped.groups.map((sg) => (
                <div key={sg.parentTitle} className="space-y-1.5">
                  {/* Group header */}
                  <div className="flex items-center gap-1.5 px-0.5">
                    <span className="text-sm font-semibold text-slate-200">{sg.parentTitle}</span>
                    <Tag color="blue" style={{ fontSize: 10, lineHeight: "16px", margin: 0, padding: "0 6px" }}>
                      宫格 {sg.subItems.length + 1}
                    </Tag>
                  </div>
                  {/* Grid image — full width */}
                  {sg.gridItem && (
                    <div className="rounded-lg overflow-hidden">{renderImageItem(sg.gridItem)}</div>
                  )}
                  {/* Sub-scenes — indented with left border */}
                  {sg.subItems.length > 0 && (
                    <div className="ml-1.5 border-l-2 border-blue-500/30 pl-2">
                      <div className="grid grid-cols-2 gap-1.5">{sg.subItems.map(renderImageItem)}</div>
                    </div>
                  )}
                </div>
              ))}
              {/* Standalone scenes */}
              {sceneGrouped.standalones.length > 0 && (
                <div className="grid grid-cols-2 gap-2">{sceneGrouped.standalones.map(renderImageItem)}</div>
              )}
            </div>
          ) : (
            <>
              {images.length > 0 && <div className="grid grid-cols-2 gap-2">{images.map(renderImageItem)}</div>}
            </>
          )}
          {videos.length > 0 && <div className="grid grid-cols-2 gap-2">{videos.map(renderVideoItem)}</div>}
          {jsons.length > 0 && <div className="space-y-2">{jsons.map(renderJsonItem)}</div>}
        </div>
      ),
    };
  });

  return (
    <>
      <aside className={ASIDE_CLASS}>
        <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2">
          <Typography.Text strong style={{ fontSize: 12 }}>Resources</Typography.Text>
          <div className="flex items-center gap-1">
            {isNovelLevel && (
              <Button
                type="text"
                size="small"
                icon={<EyeOutlined />}
                onClick={() => setPromptPreviewOpen(true)}
                className="!text-slate-400 hover:!text-slate-200"
                title="Prompt Preview"
              />
            )}
            <Button
              type="text"
              size="small"
              icon={<DownloadOutlined />}
              loading={isExporting}
              onClick={() => void handleExport()}
              className="!text-slate-400 hover:!text-slate-200"
              title="导出全部资源"
              disabled={categories.length === 0}
            />
            <Button
              type="text"
              size="small"
              icon={<FormatPainterOutlined />}
              onClick={() => setStyleDrawerOpen(true)}
              className="!text-slate-400 hover:!text-slate-200"
              title="Manage Style Presets"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {collapseItems.length > 0 ? (
            <Collapse activeKey={activeKeys} onChange={(keys) => setActiveKeys(keys as string[])} items={collapseItems} size="small" ghost />
          ) : (
            <div className="flex items-center justify-center py-6">
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No resources yet" />
            </div>
          )}
        </div>
      </aside>

      <ImageDetailDrawer
        imageGenId={selectedImageGenId}
        onClose={() => setSelectedImageGenId(null)}
        onRefresh={() => onRefresh?.()}
        sessionId={sessionId}
      />

      <VideoDetailDrawer
        keyResourceId={selectedVideoId}
        onClose={() => setSelectedVideoId(null)}
        onRefresh={() => onRefresh?.()}
        sessionId={sessionId}
      />

      <StylePresetDrawer open={styleDrawerOpen} onClose={() => setStyleDrawerOpen(false)} />

      {isNovelLevel && (
        <PromptPreviewDrawer
          open={promptPreviewOpen}
          onClose={() => setPromptPreviewOpen(false)}
          novelId={novelId}
        />
      )}

      <Drawer
        title={editingItem?.title ?? "Edit JSON"}
        open={!!editingItem}
        onClose={() => setEditingItem(null)}
        styles={{ wrapper: { width: 520 } }}
        extra={
          <Button type="primary" size="small" onClick={() => void handleSave()} loading={isSaving}>
            Save
          </Button>
        }
      >
        <Input.TextArea
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          autoSize={{ minRows: 20, maxRows: 40 }}
          style={{ fontFamily: "monospace", fontSize: 12 }}
        />
      </Drawer>
    </>
  );
}
