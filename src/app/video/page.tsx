"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Card, Empty, Spin, Typography, Button, ConfigProvider, theme as antTheme } from "antd";
import {
  ReloadOutlined,
  VideoCameraOutlined,
  UploadOutlined,
  DeleteOutlined,
} from "@ant-design/icons";
import { fetchJson } from "@/app/components/client-utils";

/* ------------------------------------------------------------------ */
/*  Types (local novels)                                               */
/* ------------------------------------------------------------------ */

interface NovelItem {
  id: string;
  name: string;
  episodeCount: number;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function VideoNovelListPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [novels, setNovels] = useState<NovelItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadNovels = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchJson<NovelItem[]>("/api/video/novels");
      setNovels(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load novels");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadNovels();
  }, [loadNovels]);

  const handleSelect = (novel: NovelItem) => {
    router.push(`/video/${novel.id}?name=${encodeURIComponent(novel.name)}`);
  };

  const handleDelete = async (novel: NovelItem) => {
    if (!confirm(`Delete "${novel.name}"? All episodes and resources will be removed.`)) return;
    try {
      await fetchJson(`/api/video/novels/${encodeURIComponent(novel.id)}`, {
        method: "DELETE",
      });
      await loadNovels();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to delete novel");
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
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
        const jsonData: unknown = JSON.parse(reader.result as string);
        // Derive novel name from filename: "complete_script_ep1_ep20.json" → "complete_script_ep1_ep20"
        const novelName = file.name.replace(/\.json$/i, "");
        void doUpload(novelName, jsonData);
      } catch {
        alert("Invalid JSON file");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const doUpload = async (name: string, episodes: unknown) => {
    setIsUploading(true);
    try {
      const result = await fetchJson<{ novelId: string }>("/api/video/novels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, episodes }),
      });
      await loadNovels();
      // Navigate to the new novel
      router.push(`/video/${result.novelId}?name=${encodeURIComponent(name)}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to upload script");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <ConfigProvider
      theme={{
        algorithm: antTheme.darkAlgorithm,
        token: { colorBgContainer: "transparent" },
      }}
    >
      <main className="flex h-screen w-full flex-col bg-slate-950 text-slate-100">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <div className="flex items-center gap-2">
            <VideoCameraOutlined style={{ fontSize: 20 }} />
            <Typography.Title level={4} style={{ margin: 0 }}>
              Video Workflow
            </Typography.Title>
          </div>
          <div className="flex items-center gap-2">
            <Button
              icon={<UploadOutlined />}
              onClick={() => fileInputRef.current?.click()}
              loading={isUploading}
              disabled={isUploading}
              type="primary"
            >
              {isUploading ? "Uploading…" : "Upload Script JSON"}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleFileUpload}
              style={{ display: "none" }}
            />
            <Button
              icon={<ReloadOutlined />}
              onClick={() => void loadNovels()}
              loading={isLoading}
            >
              Refresh
            </Button>
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {error && (
            <div className="mb-4 rounded border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-300">
              {error}
            </div>
          )}

          {isLoading ? (
            <div className="flex items-center justify-center py-20">
<Spin description="Loading novels…" size="large" />
            </div>
          ) : novels.length === 0 ? (
            <Empty description="No novels. Click Upload Script JSON to get started." style={{ marginTop: 80 }} />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
              {novels.map((novel) => (
                <Card
                  key={novel.id}
                  hoverable
                  onClick={() => handleSelect(novel)}
                  styles={{
                    body: { padding: 16 },
                  }}
                  style={{
                    background: "rgba(15, 23, 42, 0.6)",
                    borderColor: "rgb(51, 65, 85)",
                  }}
                >
                  <div className="flex items-start justify-between">
                    <Typography.Text strong style={{ fontSize: 14 }}>
                      {novel.name}
                    </Typography.Text>
                    <Button
                      type="text"
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={(e) => { e.stopPropagation(); void handleDelete(novel); }}
                      style={{ width: 24, height: 24, minWidth: 24 }}
                    />
                  </div>
                  <div className="mt-2 flex items-center gap-3 text-[11px] text-slate-400">
                    <span>{novel.episodeCount} episodes</span>
                    <span>{new Date(novel.createdAt).toLocaleDateString()}</span>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </main>
    </ConfigProvider>
  );
}
