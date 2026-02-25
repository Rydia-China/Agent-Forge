"use client";

import { useState, useCallback } from "react";
import { Button, Collapse, Drawer, Empty, Input, Spin, Typography, Image, Tag, message } from "antd";
import { SkinOutlined, PictureOutlined, FileImageOutlined, CodeOutlined, EditOutlined, DeleteOutlined } from "@ant-design/icons";
import type { EpisodeResources } from "../types";
import type { KeyResourceItem } from "@/app/types";
import { JsonViewer } from "@/app/components/JsonViewer";

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

export interface ResourcePanelProps {
  resources: EpisodeResources | null;
  isLoading: boolean;
  /** Session key resources (JSON, images, videos from LLM). */
  keyResources?: KeyResourceItem[];
  /** Called to update a JSON key resource's data. */
  onUpdateKeyResource?: (id: string, data: unknown, title?: string) => Promise<void>;
  /** Called to delete a key resource. */
  onDeleteKeyResource?: (id: string) => Promise<void>;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

const ASIDE_CLASS = "flex h-full w-56 min-w-[200px] shrink-0 flex-col border-l border-slate-800 bg-slate-950/80";

export function ResourcePanel({ resources, isLoading, keyResources, onUpdateKeyResource, onDeleteKeyResource }: ResourcePanelProps) {
  /* ---- JSON editor drawer state ---- */
  const [editingKr, setEditingKr] = useState<KeyResourceItem | null>(null);
  const [editText, setEditText] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const openEditor = useCallback((kr: KeyResourceItem) => {
    setEditingKr(kr);
    const json = kr.data != null
      ? (typeof kr.data === "string" ? kr.data : JSON.stringify(kr.data, null, 2))
      : "";
    setEditText(json);
  }, []);

  const handleSave = useCallback(async () => {
    if (!editingKr || !onUpdateKeyResource) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(editText);
    } catch {
      void message.error("Invalid JSON");
      return;
    }
    setIsSaving(true);
    try {
      await onUpdateKeyResource(editingKr.id, parsed);
      void message.success("Saved");
      setEditingKr(null);
    } catch {
      void message.error("Save failed");
    } finally {
      setIsSaving(false);
    }
  }, [editingKr, editText, onUpdateKeyResource]);

  const handleDeleteKr = useCallback(async (id: string) => {
    if (!onDeleteKeyResource) return;
    try {
      await onDeleteKeyResource(id);
      void message.success("Deleted");
    } catch {
      void message.error("Delete failed");
    }
  }, [onDeleteKeyResource]);

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

  const { costumes, sceneImages, shotImages } = resources;
  const jsonResources = keyResources?.filter((kr) => kr.mediaType === "json") ?? [];
  const hasJsonResources = jsonResources.length > 0;
  const isEmpty =
    costumes.length === 0 &&
    sceneImages.length === 0 &&
    shotImages.length === 0 &&
    !hasJsonResources;

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
    // 0. Pinned Data (JSON only — images/videos already shown in other sections)
    hasJsonResources
      ? {
          key: "pinned-data",
          label: (
            <span className="flex items-center gap-1.5 text-xs font-medium">
              <CodeOutlined /> Pinned Data
              <Tag style={{ fontSize: 10, lineHeight: "16px", margin: 0 }}>
                {jsonResources.length}
              </Tag>
            </span>
          ),
          children: (
            <div className="space-y-2">
              {jsonResources.map((kr) => (
                <div key={kr.id} className="rounded border border-slate-800 bg-slate-900/50 p-2">
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <div className="truncate text-[10px] font-medium text-slate-200">
                      {kr.title ?? "JSON"}
                    </div>
                    <div className="flex shrink-0 gap-0.5">
                      {onUpdateKeyResource && (
                        <Button type="text" size="small" icon={<EditOutlined />}
                          onClick={() => openEditor(kr)} style={{ fontSize: 10 }} />
                      )}
                      {onDeleteKeyResource && (
                        <Button type="text" size="small" danger icon={<DeleteOutlined />}
                          onClick={() => void handleDeleteKr(kr.id)} style={{ fontSize: 10 }} />
                      )}
                    </div>
                  </div>
                  {kr.data != null && (
                    <div className="cursor-pointer" onClick={() => openEditor(kr)} title="Click to edit">
                      <JsonViewer data={kr.data} />
                    </div>
                  )}
                </div>
              ))}
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
        title={editingKr?.title ?? "Edit JSON"}
        open={!!editingKr}
        onClose={() => setEditingKr(null)}
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
