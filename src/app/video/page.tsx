"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, Empty, Spin, Typography, Button, ConfigProvider, theme as antTheme } from "antd";
import { ReloadOutlined, VideoCameraOutlined } from "@ant-design/icons";
import { fetchJson } from "@/app/components/client-utils";

/* ------------------------------------------------------------------ */
/*  Types (mirrors remote novel service response)                      */
/* ------------------------------------------------------------------ */

interface NovelItem {
  id: number;
  name: string;
  content_length?: number;
  created_at?: string;
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function VideoNovelListPage() {
  const router = useRouter();
  const [novels, setNovels] = useState<NovelItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadNovels = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchJson<{ novels: NovelItem[] }>("/api/video/novels");
      setNovels(data.novels);
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
          <Button
            icon={<ReloadOutlined />}
            onClick={() => void loadNovels()}
            loading={isLoading}
          >
            Refresh
          </Button>
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
            <Empty description="No novels found" style={{ marginTop: 80 }} />
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
                  <Typography.Text strong style={{ fontSize: 14 }}>
                    {novel.name}
                  </Typography.Text>
                  <div className="mt-2 flex items-center gap-3 text-[11px] text-slate-400">
                    <span>ID: {novel.id}</span>
                    {novel.content_length != null && (
                      <span>{(novel.content_length / 1000).toFixed(0)}k chars</span>
                    )}
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
