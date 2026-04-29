"use client";

import { useState, useCallback } from "react";
import { Badge, Button, Card, Drawer, Image, Tag, Typography, Input, message } from "antd";
import { EditOutlined, DeleteOutlined } from "@ant-design/icons";
import type { KeyResourceItem } from "../types";
import { JsonViewer } from "./JsonViewer";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface KeyResourcesPanelProps {
  keyResources: KeyResourceItem[];
  onImageClick: (url: string) => void;
  /** Called to update a JSON key resource's data. */
  onUpdateJson?: (id: string, data: unknown, title?: string) => Promise<void>;
  /** Called to delete a key resource. */
  onDelete?: (id: string) => Promise<void>;
  /** When true, renders without its own aside/border/width — for embedding in a parent column. */
  embedded?: boolean;
}

export function KeyResourcesPanel({
  keyResources,
  onImageClick,
  onUpdateJson,
  onDelete,
  embedded,
}: KeyResourcesPanelProps) {
  const [editingKr, setEditingKr] = useState<KeyResourceItem | null>(null);
  const [viewingKr, setViewingKr] = useState<KeyResourceItem | null>(null);
  const [editText, setEditText] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const promptFor = useCallback((kr: KeyResourceItem): string => {
    if (typeof kr.prompt === "string") return kr.prompt;
    if (isRecord(kr.data)) {
      const prompt = kr.data.prompt;
      return typeof prompt === "string" ? prompt : "";
    }
    return "";
  }, []);

  const dataTextFor = useCallback((kr: KeyResourceItem): string => {
    if (kr.data == null) return "";
    return typeof kr.data === "string" ? kr.data : JSON.stringify(kr.data, null, 2);
  }, []);

  const openEditor = useCallback((kr: KeyResourceItem) => {
    setEditingKr(kr);
    const json = kr.data != null
      ? (typeof kr.data === "string" ? kr.data : JSON.stringify(kr.data, null, 2))
      : "";
    setEditText(json);
  }, []);

  const handleSave = useCallback(async () => {
    if (!editingKr || !onUpdateJson) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(editText);
    } catch {
      void message.error("Invalid JSON");
      return;
    }
    setIsSaving(true);
    try {
      await onUpdateJson(editingKr.id, parsed);
      void message.success("Saved");
      setEditingKr(null);
    } catch {
      void message.error("Save failed");
    } finally {
      setIsSaving(false);
    }
  }, [editingKr, editText, onUpdateJson]);

  const handleDelete = useCallback(async (id: string) => {
    if (!onDelete) return;
    try {
      await onDelete(id);
      void message.success("Deleted");
    } catch {
      void message.error("Delete failed");
    }
  }, [onDelete]);

  return (
    <>
      <aside className={embedded
        ? "flex shrink-0 flex-col bg-slate-950/80"
        : "flex w-72 shrink-0 flex-col border-l border-slate-800 bg-slate-950/80"
      }>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-800 bg-slate-950/90 px-3 py-2 backdrop-blur">
          <Typography.Text type="secondary" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            关键资源
          </Typography.Text>
          <Badge count={keyResources.length} size="small" color="gray" />
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto p-3">
          {keyResources.map((kr) => {
            const prompt = promptFor(kr);
            return (
              <Card
                key={kr.id}
                size="small"
                className="cursor-pointer"
                onClick={() => setViewingKr(kr)}
                styles={{ body: { padding: 8 } }}
              >
                <div className="flex items-start justify-between gap-1">
                  <div className="flex flex-1 items-center gap-1" style={{ marginBottom: 6 }}>
                    {kr.title && (
                      <Typography.Text style={{ fontSize: 11, fontWeight: 500, flex: 1 }}>
                        {kr.title}
                      </Typography.Text>
                    )}
                    {kr.currentVersion > 1 && (
                      <Tag color="blue" style={{ fontSize: 9, lineHeight: "14px", margin: 0, padding: "0 4px" }}>
                        v{kr.currentVersion}
                      </Tag>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-0.5">
                    {kr.mediaType === "json" && onUpdateJson && (
                      <Button
                        type="text"
                        size="small"
                        icon={<EditOutlined />}
                        onClick={(e) => {
                          e.stopPropagation();
                          openEditor(kr);
                        }}
                        style={{ fontSize: 10 }}
                      />
                    )}
                    {onDelete && (
                      <Button
                        type="text"
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleDelete(kr.id);
                        }}
                        style={{ fontSize: 10 }}
                      />
                    )}
                  </div>
                </div>
                {kr.mediaType === "image" && kr.url && (
                  <Image
                    src={kr.url}
                    alt={kr.title ?? "Image"}
                    style={{ width: "100%", objectFit: "cover", borderRadius: 4, cursor: "pointer" }}
                    preview={false}
                    onClick={(e) => {
                      e.stopPropagation();
                      onImageClick(kr.url);
                    }}
                  />
                )}
                {kr.mediaType === "video" && kr.url && (
                  <video
                    src={kr.url}
                    controls
                    className="w-full rounded"
                    onClick={(e) => e.stopPropagation()}
                  />
                )}
                {kr.mediaType === "json" && kr.data != null && (
                  <div title="Click to view">
                    <JsonViewer data={kr.data} />
                  </div>
                )}
                {prompt && kr.mediaType !== "json" && (
                  <Typography.Paragraph
                    type="secondary"
                    ellipsis={{ rows: 3 }}
                    style={{ fontSize: 10, marginTop: 6, marginBottom: 0 }}
                  >
                    {prompt}
                  </Typography.Paragraph>
                )}
                {!kr.url && kr.mediaType !== "json" && (
                  <Typography.Text type="secondary" style={{ fontSize: 10 }}>
                    {prompt ? "待生成" : "No content"}
                  </Typography.Text>
                )}
              </Card>
            );
          })}
        </div>
      </aside>

      <Drawer
        title={viewingKr?.title ?? viewingKr?.key ?? "Resource"}
        open={!!viewingKr}
        onClose={() => setViewingKr(null)}
        styles={{ wrapper: { width: 560 } }}
      >
        {viewingKr && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <Tag>{viewingKr.mediaType}</Tag>
              <Tag>v{viewingKr.currentVersion}</Tag>
            </div>
            <div>
              <Typography.Text type="secondary" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Prompt
              </Typography.Text>
              <Input.TextArea
                value={promptFor(viewingKr)}
                readOnly
                autoSize={{ minRows: 6, maxRows: 18 }}
                style={{ marginTop: 8, fontSize: 12 }}
              />
            </div>
            {viewingKr.data != null && (
              <div>
                <Typography.Text type="secondary" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Data
                </Typography.Text>
                <Input.TextArea
                  value={dataTextFor(viewingKr)}
                  readOnly
                  autoSize={{ minRows: 6, maxRows: 18 }}
                  style={{ marginTop: 8, fontFamily: "monospace", fontSize: 12 }}
                />
              </div>
            )}
          </div>
        )}
      </Drawer>

      {/* JSON Editor Drawer */}
      <Drawer
        title={editingKr?.title ?? "Edit JSON"}
        open={!!editingKr}
        onClose={() => setEditingKr(null)}
        styles={{ wrapper: { width: 520 } }}
        extra={
          <Button
            type="primary"
            size="small"
            onClick={() => void handleSave()}
            loading={isSaving}
          >
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
