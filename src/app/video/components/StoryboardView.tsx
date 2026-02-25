"use client";

import { useState, useCallback } from "react";
import { Button, Drawer, Empty, Spin } from "antd";
import { FileTextOutlined, LoadingOutlined } from "@ant-design/icons";
import { fetchJson } from "@/app/components/client-utils";
import type { StoryboardScene, ShotDetail } from "../types";

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

export interface StoryboardViewProps {
  scenes: StoryboardScene[];
  isLoading: boolean;
  scriptKey: string | null;
  /** Episode DB id — needed to fetch content */
  episodeId: string | null;
}

/* ------------------------------------------------------------------ */
/*  Flatten scenes → shots, keep only those with video structure       */
/* ------------------------------------------------------------------ */

function collectShots(scenes: StoryboardScene[]): ShotDetail[] {
  return scenes
    .flatMap(({ shots }) => shots)
    .sort((a, b) => {
      const sa = a.sceneIndex * 1000 + parseInt(a.shotIndex ?? "0", 10);
      const sb = b.sceneIndex * 1000 + parseInt(b.shotIndex ?? "0", 10);
      return sa - sb;
    });
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function StoryboardView({ scenes, isLoading, scriptKey, episodeId }: StoryboardViewProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [epContent, setEpContent] = useState<string | null>(null);
  const [loadingContent, setLoadingContent] = useState(false);

  const openEpContent = useCallback(async () => {
    if (!episodeId) return;
    setDrawerOpen(true);
    if (epContent !== null) return; // already loaded
    setLoadingContent(true);
    try {
      const res = await fetchJson<{ content: string | null }>(
        `/api/video/episodes/${encodeURIComponent(episodeId)}/content`,
      );
      setEpContent(res.content ?? "(empty)");
    } catch {
      setEpContent("Failed to load EP content");
    } finally {
      setLoadingContent(false);
    }
  }, [episodeId, epContent]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spin description="Loading…" />
      </div>
    );
  }

  const shots = collectShots(scenes);

  if (!scriptKey || shots.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No videos yet" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4">
      {/* EP content button */}
      <div className="flex justify-center py-3">
        <Button
          icon={<FileTextOutlined />}
          onClick={() => void openEpContent()}
          block
        >
          View EP Content
        </Button>
      </div>

      <Drawer
        title="EP Content"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        size={520}
      >
        {loadingContent ? (
          <div className="flex justify-center py-8"><Spin /></div>
        ) : (
          <pre className="whitespace-pre-wrap text-sm leading-relaxed">{epContent}</pre>
        )}
      </Drawer>

      <div className="grid grid-cols-2 gap-3">
        {shots.map((shot) => (
          <div
            key={shot.id}
            className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900/50"
          >
            {shot.videoUrl ? (
              <video
                src={shot.videoUrl}
                poster={shot.imageUrl ?? undefined}
                controls
                muted
                className="aspect-[9/16] w-full object-cover"
              />
            ) : (
              <div className="relative aspect-[9/16] w-full bg-slate-800">
                <div className="absolute bottom-1.5 right-1.5 flex items-center gap-1 rounded bg-slate-900/80 px-1.5 py-0.5">
                  <Spin indicator={<LoadingOutlined className="text-xs text-slate-400" />} size="small" />
                  <span className="text-[10px] text-slate-400">Generating...</span>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
