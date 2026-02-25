"use client";

import { useState, useCallback } from "react";
import { Badge, Button, Card, Drawer, Image, Typography, Input, message } from "antd";
import { EditOutlined, DeleteOutlined } from "@ant-design/icons";
import type { KeyResourceItem } from "../types";
import { JsonViewer } from "./JsonViewer";

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
          {keyResources.map((kr) => (
            <Card key={kr.id} size="small" styles={{ body: { padding: 8 } }}>
              <div className="flex items-start justify-between gap-1">
                {kr.title && (
                  <Typography.Text style={{ fontSize: 11, fontWeight: 500, flex: 1, marginBottom: 6 }}>
                    {kr.title}
                  </Typography.Text>
                )}
                {kr.mediaType === "json" && (
                  <div className="flex shrink-0 gap-0.5">
                    {onUpdateJson && (
                      <Button
                        type="text"
                        size="small"
                        icon={<EditOutlined />}
                        onClick={() => openEditor(kr)}
                        style={{ fontSize: 10 }}
                      />
                    )}
                    {onDelete && (
                      <Button
                        type="text"
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() => void handleDelete(kr.id)}
                        style={{ fontSize: 10 }}
                      />
                    )}
                  </div>
                )}
              </div>
              {kr.mediaType === "image" && kr.url && (
                <Image
                  src={kr.url}
                  alt={kr.title ?? "Image"}
                  style={{ width: "100%", objectFit: "cover", borderRadius: 4, cursor: "pointer" }}
                  preview={false}
                  onClick={() => onImageClick(kr.url!)}
                />
              )}
              {kr.mediaType === "video" && kr.url && (
                <video
                  src={kr.url}
                  controls
                  className="w-full rounded"
                />
              )}
              {kr.mediaType === "json" && kr.data != null && (
                <div
                  className="cursor-pointer"
                  onClick={() => openEditor(kr)}
                  title="Click to edit"
                >
                  <JsonViewer data={kr.data} />
                </div>
              )}
              {!kr.url && kr.mediaType !== "json" && (
                <Typography.Text type="secondary" style={{ fontSize: 10 }}>No content</Typography.Text>
              )}
            </Card>
          ))}
        </div>
      </aside>

      {/* JSON Editor Drawer */}
      <Drawer
        title={editingKr?.title ?? "Edit JSON"}
        open={!!editingKr}
        onClose={() => setEditingKr(null)}
        size={520}
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
