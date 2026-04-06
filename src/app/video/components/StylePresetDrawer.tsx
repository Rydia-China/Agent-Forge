"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Drawer, Button, Input, Flex, Popconfirm, Spin, Empty, App, Image,
} from "antd";
import { PlusOutlined, DeleteOutlined, EditOutlined, SaveOutlined, CloseOutlined, UploadOutlined } from "@ant-design/icons";
import { fetchJson } from "@/app/components/client-utils";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface StylePreset {
  id: string;
  name: string;
  prompt: string;
  referenceImageUrl: string | null;
}

type EditingState =
  | { mode: "idle" }
  | { mode: "create"; name: string; prompt: string; referenceImageUrl: string }
  | { mode: "edit"; id: string; name: string; prompt: string; referenceImageUrl: string };

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

export interface StylePresetDrawerProps {
  open: boolean;
  onClose: () => void;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function StylePresetDrawer({ open, onClose }: StylePresetDrawerProps) {
  const { message } = App.useApp();
  const [presets, setPresets] = useState<StylePreset[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [editing, setEditing] = useState<EditingState>({ mode: "idle" });
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* ---- Fetch ---- */
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchJson<StylePreset[]>("/api/style-presets");
      setPresets(data);
    } catch {
      void message.error("Failed to load style presets");
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  /* ---- Save (create or update) ---- */
  const handleSave = async () => {
    if (editing.mode === "idle") return;
    const { name, prompt, referenceImageUrl } = editing;
    if (!name.trim() || !prompt.trim()) {
      void message.warning("Name and prompt are required");
      return;
    }

    setSaving(true);
    try {
      if (editing.mode === "create") {
        await fetchJson("/api/style-presets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            prompt: prompt.trim(),
            ...(referenceImageUrl.trim() ? { referenceImageUrl: referenceImageUrl.trim() } : {}),
          }),
        });
        void message.success("Created");
      } else {
        await fetchJson(`/api/style-presets/${editing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            prompt: prompt.trim(),
            referenceImageUrl: referenceImageUrl.trim() || null,
          }),
        });
        void message.success("Updated");
      }
      setEditing({ mode: "idle" });
      await load();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Save failed";
      void message.error(msg);
    } finally {
      setSaving(false);
    }
  };

  /* ---- Upload reference image to OSS ---- */
  const handleUpload = async (file: File) => {
    if (editing.mode === "idle") return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("folder", "style-ref");
      const { url } = await fetchJson<{ url: string }>("/api/oss/upload", {
        method: "POST",
        body: formData,
      });
      setEditing({ ...editing, referenceImageUrl: url });
      void message.success("Uploaded");
    } catch {
      void message.error("Upload failed");
    } finally {
      setUploading(false);
    }
  };

  /* ---- Delete ---- */
  const handleDelete = async (id: string) => {
    try {
      await fetchJson(`/api/style-presets/${id}`, { method: "DELETE" });
      void message.success("Deleted");
      await load();
    } catch {
      void message.error("Delete failed");
    }
  };

  /* ---- Render ---- */
  const isEditing = editing.mode !== "idle";

  return (
    <Drawer
      title="Style Presets"
      open={open}
      onClose={onClose}
      styles={{ wrapper: { width: 420 } }}
      extra={
        !isEditing && (
          <Button
            type="primary"
            size="small"
            icon={<PlusOutlined />}
            onClick={() => setEditing({ mode: "create", name: "", prompt: "", referenceImageUrl: "" })}
          >
            New
          </Button>
        )
      }
    >
      {isEditing ? (
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs text-slate-400">Name</label>
            <Input
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              placeholder="e.g. anime-flat"
              size="small"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">Prompt (style words)</label>
            <Input.TextArea
              value={editing.prompt}
              onChange={(e) => setEditing({ ...editing, prompt: e.target.value })}
              placeholder="e.g. anime style, flat color, soft lighting, ..."
              autoSize={{ minRows: 3, maxRows: 8 }}
              style={{ fontSize: 12 }}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">Reference Image (optional)</label>
            <div className="flex gap-2">
              <Input
                value={editing.referenceImageUrl}
                onChange={(e) => setEditing({ ...editing, referenceImageUrl: e.target.value })}
                placeholder="https://... or upload"
                size="small"
                className="flex-1"
              />
              <Button
                size="small"
                icon={<UploadOutlined />}
                loading={uploading}
                onClick={() => fileInputRef.current?.click()}
              >
                Upload
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleUpload(file);
                  e.target.value = "";
                }}
              />
            </div>
            {editing.referenceImageUrl.trim() && (
              <div className="mt-2">
                <Image
                  src={editing.referenceImageUrl.trim()}
                  alt="preview"
                  width={120}
                  style={{ borderRadius: 4 }}
                  fallback="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTIwIiBoZWlnaHQ9IjgwIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxyZWN0IHdpZHRoPSIxMjAiIGhlaWdodD0iODAiIGZpbGw9IiMxZTI5M2IiLz48dGV4dCB4PSI2MCIgeT0iNDUiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZpbGw9IiM2NDc0OGIiIGZvbnQtc2l6ZT0iMTIiPk5vIGltYWdlPC90ZXh0Pjwvc3ZnPg=="
                />
              </div>
            )}
          </div>
          <div className="flex gap-2 pt-2">
            <Button
              type="primary"
              size="small"
              icon={<SaveOutlined />}
              loading={saving}
              onClick={() => void handleSave()}
            >
              Save
            </Button>
            <Button
              size="small"
              icon={<CloseOutlined />}
              onClick={() => setEditing({ mode: "idle" })}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : loading ? (
        <div className="flex items-center justify-center py-10"><Spin /></div>
      ) : presets.length === 0 ? (
        <Empty description="No style presets" />
      ) : (
        <div className="space-y-0 divide-y divide-slate-700/40">
          {presets.map((item) => (
            <Flex key={item.id} align="center" justify="space-between" gap={8} className="py-3">
              <div className="min-w-0 flex-1">
                <span className="text-sm">{item.name}</span>
                <div className="space-y-1 mt-1">
                  <p className="line-clamp-2 text-xs text-slate-400">{item.prompt}</p>
                  {item.referenceImageUrl && (
                    <Image
                      src={item.referenceImageUrl}
                      alt="ref"
                      width={60}
                      style={{ borderRadius: 4 }}
                    />
                  )}
                </div>
              </div>
              <Flex gap={4} align="center" className="shrink-0">
                <Button
                  type="text"
                  size="small"
                  icon={<EditOutlined />}
                  onClick={() =>
                    setEditing({
                      mode: "edit",
                      id: item.id,
                      name: item.name,
                      prompt: item.prompt,
                      referenceImageUrl: item.referenceImageUrl ?? "",
                    })
                  }
                />
                <Popconfirm
                  title="Delete this style preset?"
                  onConfirm={() => void handleDelete(item.id)}
                  okText="Delete"
                  cancelText="Cancel"
                >
                  <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                </Popconfirm>
              </Flex>
            </Flex>
          ))}
        </div>
      )}
    </Drawer>
  );
}
