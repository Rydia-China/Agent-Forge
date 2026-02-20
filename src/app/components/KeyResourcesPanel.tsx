"use client";

import { Badge, Card, Image, Typography } from "antd";
import type { KeyResourceItem } from "../types";
import { JsonViewer } from "./JsonViewer";

export interface KeyResourcesPanelProps {
  keyResources: KeyResourceItem[];
  onImageClick: (url: string) => void;
}

export function KeyResourcesPanel({
  keyResources,
  onImageClick,
}: KeyResourcesPanelProps) {
  return (
    <aside className="flex w-72 shrink-0 flex-col border-l border-slate-800 bg-slate-950/80">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-800 bg-slate-950/90 px-3 py-2 backdrop-blur">
        <Typography.Text type="secondary" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>
          关键资源
        </Typography.Text>
        <Badge count={keyResources.length} size="small" color="gray" />
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {keyResources.map((kr) => (
          <Card key={kr.id} size="small" styles={{ body: { padding: 8 } }}>
            {kr.title && (
              <Typography.Text style={{ fontSize: 11, fontWeight: 500, display: "block", marginBottom: 6 }}>
                {kr.title}
              </Typography.Text>
            )}
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
              <JsonViewer data={kr.data} />
            )}
            {!kr.url && kr.mediaType !== "json" && (
              <Typography.Text type="secondary" style={{ fontSize: 10 }}>No content</Typography.Text>
            )}
          </Card>
        ))}
      </div>
    </aside>
  );
}
