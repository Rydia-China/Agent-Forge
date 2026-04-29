"use client";

import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import { Button, Collapse, Drawer, Empty, Input, Spin, Typography, Image, Tag, App } from "antd";
import { DeleteOutlined, EditOutlined, EyeOutlined, FormatPainterOutlined, SkinOutlined } from "@ant-design/icons";
import type { DomainResources, DomainResource, VideoResourceData } from "../types";
import { fetchJson } from "@/app/components/client-utils";
import { ImageDetailDrawer } from "./ImageDetailDrawer";
import { VideoDetailDrawer } from "./VideoDetailDrawer";
import { StylePresetDrawer } from "./StylePresetDrawer";
import { PromptPreviewDrawer } from "./PromptPreviewDrawer";
import { CostumePreviewDrawer } from "./CostumePreviewDrawer";

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

export interface ResourcePanelProps {
  resources: DomainResources | null;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function ResourcePanel({ resources, isLoading, novelId, scriptId, isNovelLevel, onRefresh }: ResourcePanelProps) {
  const { message } = App.useApp();

  /* ---- JSON editor drawer state ---- */
  const [editingItem, setEditingItem] = useState<{ id: string; title: string; data: unknown } | null>(null);
  const [editText, setEditText] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  /* ---- Image detail drawer state ---- */
  const [selectedImageGenId, setSelectedImageGenId] = useState<string | null>(null);

  /* ---- Video detail drawer state ---- */
  const [selectedVideoResource, setSelectedVideoResource] = useState<DomainResource | null>(null);

  /* ---- Style preset drawer state ---- */
  const [styleDrawerOpen, setStyleDrawerOpen] = useState(false);

  /* ---- Prompt preview drawer state ---- */
  const [promptPreviewOpen, setPromptPreviewOpen] = useState(false);

  /* ---- Costume preview drawer state ---- */
  const [costumePreviewOpen, setCostumePreviewOpen] = useState(false);

  /* ---- Collapse expand state (controlled) ---- */
  const [activeKeys, setActiveKeys] = useState<string[]>([]);
  const knownKeysRef = useRef<Set<string>>(new Set());

  /* ---- Smart image rendering ---- */
  const renderSmartImage = (url: string, alt: string, keyResourceId?: string | null) => {
    if (keyResourceId) {
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={alt}
          className="w-full cursor-pointer"
          style={{ display: "block" }}
          onClick={() => setSelectedImageGenId(keyResourceId)}
        />
      );
    }
    return (
      <Image
        src={url}
        alt={alt}
        width="100%"
        style={{ display: "block" }}
      placeholder={<div className="aspect-square w-full bg-slate-800" />}
        preview={true}
      />
    );
  };
  const jsonDataForDisplay = (r: DomainResource): unknown => {
    const hasPrompt = typeof r.prompt === "string";
    const hasRefUrls = Array.isArray(r.refUrls);
    if (r.category === "视频Prompt") {
      const data = isRecord(r.data) ? r.data : {};
      return {
        shot_function: data.shot_function,
        prev_shot_recap: data.prev_shot_recap,
        next_shot_setup: data.next_shot_setup,
        definition: data.definition,
        duration: data.duration,
        prompt: r.prompt ?? data.prompt,
        refUrls: r.refUrls ?? data.refUrls,
        review: isRecord(data.reviewResult)
          ? {
              passed: data.reviewResult.passed,
              allowVideoGeneration: data.reviewResult.allowVideoGeneration,
              suggestions: data.reviewResult.suggestions,
              summary: data.reviewResult.summary,
            }
          : undefined,
      };
    }
    if (!hasPrompt && !hasRefUrls) return r.data;
    if (!isRecord(r.data)) {
      return r.data;
    }
    return {
      ...r.data,
      ...(hasPrompt ? { prompt: r.prompt } : {}),
      ...(hasRefUrls ? { refUrls: r.refUrls } : {}),
    };
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
  }, [scriptId, onRefresh, message]);

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
  }, [editingItem, editText, scriptId, onRefresh, message]);

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

  const renderImageItem = (r: DomainResource) => (
    <div key={r.id} className="group/card relative overflow-hidden rounded-lg">
      {renderDeleteBtn(r.id)}
      {r.url ? (
        renderSmartImage(r.url, r.title ?? "Image", r.keyResourceId ?? r.id)
      ) : (
        <div className="flex aspect-square items-center justify-center bg-slate-800">
          <span className="text-xs text-slate-600">No image</span>
        </div>
      )}
      {r.title && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 pb-1.5 pt-5">
          <div className="truncate text-center text-[11px] font-medium text-white">{r.title}</div>
        </div>
      )}
    </div>
  );

  const renderVideoItem = (r: DomainResource) => {
    const vData = r.data as VideoResourceData | null;
    const handleClick = () => {
      if (r.keyResourceId) {
        setSelectedImageGenId(r.keyResourceId);
      } else {
        setSelectedVideoResource(r);
      }
    };
    return (
      <div key={r.id} className="group/card relative cursor-pointer overflow-hidden rounded-lg" onClick={handleClick}>
        {renderDeleteBtn(r.id)}
        {r.url ? (
          <video src={r.url} controls muted className="aspect-[9/16] w-full object-cover" onClick={(e) => e.stopPropagation()} />
        ) : vData?.sourceImageUrl ? (
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={vData.sourceImageUrl}
              alt={r.title ?? "Source"}
              className="aspect-[9/16] w-full object-cover opacity-50"
            />
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40 px-2">
              <span className="mb-1 text-[10px] font-medium text-amber-400">待生成</span>
              {vData.prompt && (
                <p className="line-clamp-3 text-center text-[10px] leading-relaxed text-white/80">
                  {vData.prompt}
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="flex aspect-[9/16] flex-col items-center justify-center bg-slate-800 px-2">
            <span className="mb-1 text-[10px] font-medium text-amber-400">待生成</span>
            {vData?.prompt ? (
              <p className="line-clamp-4 text-center text-[10px] leading-relaxed text-slate-500">
                {vData.prompt}
              </p>
            ) : (
              <span className="text-xs text-slate-600">No prompt</span>
            )}
          </div>
        )}
        {r.title && (
          <div className="px-2 py-1 text-center text-[11px] text-slate-400">{r.title}</div>
        )}
      </div>
    );
  };

  const renderJsonItem = (r: DomainResource) => {
    const data = jsonDataForDisplay(r);
    const text = data != null
      ? (typeof data === "string" ? data : JSON.stringify(data, null, 2))
      : "";
    return (
      <div
        key={r.id}
        className="group/card relative cursor-pointer overflow-hidden rounded-lg bg-slate-900"
        onClick={() => openEditor({ id: r.id, title: r.title ?? "JSON", data })}
        title="Click to edit"
      >
        {renderDeleteBtn(r.id)}
        <pre className="max-h-32 overflow-hidden whitespace-pre-wrap break-all px-2 pt-2 pb-8 font-mono text-[9px] leading-relaxed text-slate-400">
          {text}
        </pre>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/50 to-transparent px-2 pb-1.5 pt-6">
          <div className="flex items-center justify-between">
            <div className="truncate text-[11px] font-medium text-white">{r.title ?? "JSON"}</div>
            <EditOutlined className="text-[11px] text-white/70" />
          </div>
        </div>
      </div>
    );
  };

  /* ---- Auto-expand newly appeared categories, preserve existing expand state ---- */
  const categories = useMemo(() => resources?.categories ?? [], [resources?.categories]);
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

  if (categories.length === 0) {
    return (
      <aside className={ASIDE_CLASS}>
        <div className="flex flex-1 items-center justify-center">
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No resources yet" />
        </div>
      </aside>
    );
  }

  const items = [
    ...categories.map((g) => {
      const images = g.items.filter((r) => r.mediaType === "image");
      const videos = g.items.filter((r) => r.mediaType === "video");
      const jsons = g.items.filter((r) => r.mediaType === "json");

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
            {images.length > 0 && <div className="grid grid-cols-2 gap-2">{images.map(renderImageItem)}</div>}
            {videos.length > 0 && <div className="grid grid-cols-2 gap-2">{videos.map(renderVideoItem)}</div>}
            {jsons.length > 0 && <div className="space-y-2">{jsons.map(renderJsonItem)}</div>}
          </div>
        ),
      };
    }),
  ];

  return (
    <>
      <aside className={ASIDE_CLASS}>
        <div className="border-b border-slate-800 px-3 py-2">
          <div className="flex items-center justify-between">
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
                  style={{ width: 28, height: 28, minWidth: 28 }}
                />
              )}
              {!isNovelLevel && scriptId && (
                <Button
                  type="text"
                  size="small"
                  icon={<SkinOutlined />}
                  onClick={() => setCostumePreviewOpen(true)}
                  className="!text-slate-400 hover:!text-slate-200"
                  title="Costume Preview"
                  style={{ width: 28, height: 28, minWidth: 28 }}
                />
              )}
              <Button
                type="text"
                size="small"
                icon={<FormatPainterOutlined />}
                onClick={() => setStyleDrawerOpen(true)}
                className="!text-slate-400 hover:!text-slate-200"
                title="Style Presets"
                style={{ width: 28, height: 28, minWidth: 28 }}
              />
            </div>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          <Collapse activeKey={activeKeys} onChange={(keys) => setActiveKeys(keys as string[])} items={items} size="small" ghost />
        </div>
      </aside>

      <ImageDetailDrawer
        imageGenId={selectedImageGenId}
        onClose={() => setSelectedImageGenId(null)}
        onRefresh={() => onRefresh?.()}
      />

      <VideoDetailDrawer
        resource={selectedVideoResource}
        onClose={() => setSelectedVideoResource(null)}
      />

      <StylePresetDrawer open={styleDrawerOpen} onClose={() => setStyleDrawerOpen(false)} />

      {isNovelLevel && (
        <PromptPreviewDrawer
          open={promptPreviewOpen}
          onClose={() => setPromptPreviewOpen(false)}
          novelId={novelId}
        />
      )}

      {!isNovelLevel && (
        <CostumePreviewDrawer
          open={costumePreviewOpen}
          onClose={() => setCostumePreviewOpen(false)}
          novelId={novelId}
          scriptId={scriptId}
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
