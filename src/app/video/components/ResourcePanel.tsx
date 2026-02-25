"use client";

import { useState, useCallback } from "react";
import { Button, Collapse, Drawer, Empty, Input, Spin, Typography, Image, Tag, App } from "antd";
import { SkinOutlined, PictureOutlined, FileImageOutlined, CodeOutlined, EditOutlined, AppstoreOutlined } from "@ant-design/icons";
import type { EpisodeResources, JsonResource } from "../types";
import { fetchJson } from "@/app/components/client-utils";

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

export interface ResourcePanelProps {
  resources: EpisodeResources | null;
  isLoading: boolean;
  /** Script ID needed to call the PATCH API. */
  scriptId: string | null;
  /** Called after a JSON resource is saved so parent can refresh. */
  onRefresh?: () => void;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

const ASIDE_CLASS = "flex h-full w-56 min-w-[200px] shrink-0 flex-col border-l border-slate-800 bg-slate-950/80";

export function ResourcePanel({ resources, isLoading, scriptId, onRefresh }: ResourcePanelProps) {
  const { message } = App.useApp();
  /* ---- JSON editor drawer state ---- */
  const [editingItem, setEditingItem] = useState<JsonResource | null>(null);
  const [editText, setEditText] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const openEditor = useCallback((item: JsonResource) => {
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

  if (isLoading) {
    return (
      <aside className={ASIDE_CLASS}>
        <div className="flex flex-1 items-center justify-center">
          <Spin size="small" />
        </div>
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

  const { costumes, sceneImages, shotImages, jsonData, otherImages } = resources;
  const hasJsonData = jsonData.length > 0;
  const hasOtherImages = otherImages.length > 0;
  const isEmpty =
    costumes.length === 0 &&
    sceneImages.length === 0 &&
    shotImages.length === 0 &&
    !hasJsonData &&
    !hasOtherImages;

  if (isEmpty) {
    return (
      <aside className={ASIDE_CLASS}>
        <div className="flex flex-1 items-center justify-center">
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No resources yet" />
        </div>
      </aside>
    );
  }

  /* Items ordered by pipeline step */
  const items = [
    // 0. Pinned Data (from DB columns like card_raw, storyboard_raw)
    hasJsonData
      ? {
          key: "pinned-data",
          label: (
            <span className="flex items-center gap-1.5 text-xs font-medium">
              <CodeOutlined /> Pinned Data
              <Tag style={{ fontSize: 10, lineHeight: "16px", margin: 0 }}>
                {jsonData.length}
              </Tag>
            </span>
          ),
          children: (
            <div className="space-y-2">
              {jsonData.map((item) => {
                const text = item.data != null
                  ? (typeof item.data === "string" ? item.data : JSON.stringify(item.data, null, 2))
                  : "";
                return (
                  <div
                    key={item.id}
                    className="relative cursor-pointer overflow-hidden rounded-lg bg-slate-900"
                    onClick={() => openEditor(item)}
                    title="Click to edit"
                  >
                    {/* JSON content — fixed height, overflow hidden */}
                    <pre className="max-h-32 overflow-hidden whitespace-pre-wrap break-all px-2 pt-2 pb-8 font-mono text-[9px] leading-relaxed text-slate-400">
                      {text}
                    </pre>
                    {/* Bottom gradient overlay with title + edit icon */}
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/50 to-transparent px-2 pb-1.5 pt-6">
                      <div className="flex items-center justify-between">
                        <div className="truncate text-[11px] font-medium text-white">
                          {item.title}
                        </div>
                        <EditOutlined className="text-[11px] text-white/70" />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ),
        }
      : null,

    // Costumes
    costumes.length > 0
      ? {
          key: "costumes",
          label: (
            <span className="flex items-center gap-1.5 text-xs font-medium">
              <SkinOutlined /> Costumes
              <Tag style={{ fontSize: 10, lineHeight: "16px", margin: 0 }}>
                {costumes.length}
              </Tag>
            </span>
          ),
          children: (
            <div className="grid grid-cols-2 gap-2">
              {costumes.map((c) => (
                <div key={c.id} className="relative overflow-hidden rounded-lg">
                  {c.costumeImageUrl ? (
                    <Image
                      src={c.costumeImageUrl}
                      alt={c.characterName}
                      width="100%"
                      style={{ display: "block" }}
                      placeholder={<div className="aspect-[9/16] w-full bg-slate-800" />}
                      preview={true}
                    />
                  ) : (
                    <div className="flex aspect-[9/16] items-center justify-center bg-slate-800">
                      <SkinOutlined className="text-lg text-slate-600" />
                    </div>
                  )}
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 pb-1.5 pt-5">
                    <div className="truncate text-center text-[11px] font-medium text-white">
                      {c.characterName}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ),
        }
      : null,

    // 3. Scene Images
    sceneImages.filter((s) => s.sceneImageUrl).length > 0
      ? {
          key: "scenes",
          label: (
            <span className="flex items-center gap-1.5 text-xs font-medium">
              <PictureOutlined /> Scene Images
              <Tag style={{ fontSize: 10, lineHeight: "16px", margin: 0 }}>
                {sceneImages.filter((s) => s.sceneImageUrl).length}
              </Tag>
            </span>
          ),
          children: (
            <div className="grid grid-cols-2 gap-2">
              {sceneImages
                .filter((s) => s.sceneImageUrl)
                .map((s) => (
                  <div key={s.id} className="relative overflow-hidden rounded-lg">
                    <Image
                      src={s.sceneImageUrl!}
                      alt={s.sceneTitle ?? `Scene ${s.sceneIndex}`}
                      width="100%"
                      style={{ display: "block" }}
                      placeholder={<div className="aspect-[9/16] w-full bg-slate-800" />}
                      preview={true}
                    />
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 pb-1.5 pt-5">
                      <div className="truncate text-center text-[11px] font-medium text-white">
                        {s.sceneTitle ?? `Scene ${s.sceneIndex}`}
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          ),
        }
      : null,

    // 4. Shot Images (generated stills)
    shotImages.length > 0
      ? {
          key: "shots",
          label: (
            <span className="flex items-center gap-1.5 text-xs font-medium">
              <FileImageOutlined /> Shot Images
              <Tag style={{ fontSize: 10, lineHeight: "16px", margin: 0 }}>
                {shotImages.length}
              </Tag>
            </span>
          ),
          children: (
            <div className="grid grid-cols-2 gap-2">
              {shotImages.map((s) => (
                <div key={s.id} className="relative overflow-hidden rounded-lg">
                  <Image
                    src={s.imageUrl}
                    alt={`S${s.sceneIndex}-${s.shotIndex ?? "?"}`}
                    width="100%"
                    style={{ display: "block" }}
                    placeholder={<div className="aspect-[9/16] w-full bg-slate-800" />}
                    preview={true}
                  />
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 pb-1.5 pt-5">
                    <div className="truncate text-center text-[11px] font-medium text-white">
                      S{s.sceneIndex}-{s.shotIndex ?? "?"}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ),
        }
      : null,
    // 5. Other Images (generated but not in any known category)
    hasOtherImages
      ? {
          key: "others",
          label: (
            <span className="flex items-center gap-1.5 text-xs font-medium">
              <AppstoreOutlined /> Others
              <Tag style={{ fontSize: 10, lineHeight: "16px", margin: 0 }}>
                {otherImages.length}
              </Tag>
            </span>
          ),
          children: (
            <div className="grid grid-cols-2 gap-2">
              {otherImages.map((img) => (
                <div key={img.id} className="relative overflow-hidden rounded-lg">
                  <Image
                    src={img.url}
                    alt={img.title ?? "Generated"}
                    width="100%"
                    style={{ display: "block" }}
                    placeholder={<div className="aspect-[9/16] w-full bg-slate-800" />}
                    preview={true}
                  />
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 pb-1.5 pt-5">
                    <div className="truncate text-center text-[11px] font-medium text-white">
                      {img.title ?? "Generated"}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ),
        }
      : null,
  ].filter(Boolean) as { key: string; label: React.ReactNode; children: React.ReactNode }[];

  return (
    <>
      <aside className={ASIDE_CLASS}>
        <div className="border-b border-slate-800 px-3 py-2">
          <Typography.Text strong style={{ fontSize: 12 }}>
            Resources
          </Typography.Text>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          <Collapse
            defaultActiveKey={items.map((i) => i.key)}
            items={items}
            size="small"
            ghost
          />
        </div>
      </aside>

      {/* JSON Editor Drawer */}
      <Drawer
        title={editingItem?.title ?? "Edit JSON"}
        open={!!editingItem}
        onClose={() => setEditingItem(null)}
        size={520}
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
