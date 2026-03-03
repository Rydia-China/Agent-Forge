"use client";

import { Button, Drawer, Input, Typography, Tag, Tooltip } from "antd";
import { CopyOutlined } from "@ant-design/icons";
import type { DomainResource, VideoResourceData } from "../types";

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

export interface VideoDetailDrawerProps {
  /** The DomainResource to display. null = closed. */
  resource: DomainResource | null;
  onClose: () => void;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function VideoDetailDrawer({ resource, onClose }: VideoDetailDrawerProps) {
  const vData = resource?.data as VideoResourceData | null;
  const prompt = vData?.prompt ?? "";

  return (
    <Drawer
      title={
        resource ? (
          <div className="flex items-center gap-2">
            <span className="truncate text-sm">{resource.title ?? "Video"}</span>
            <Tag color="orange" style={{ fontSize: 10, lineHeight: "16px", margin: 0 }}>
              待生成
            </Tag>
          </div>
        ) : "Video Detail"
      }
      open={!!resource}
      onClose={onClose}
      styles={{ wrapper: { width: 720 } }}
      destroyOnClose
    >
      <div className="flex gap-5" style={{ height: "calc(100vh - 110px)" }}>
        {/* ── Left Column: Source Image ── */}
        <div className="flex w-1/2 flex-col gap-3">
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg border border-slate-700 bg-slate-900/30">
            <div className="flex flex-col items-center gap-1">
              <span className="text-sm font-medium text-amber-400">待生成</span>
            </div>
          </div>
        </div>

        {/* ── Right Column: Prompt (read-only) ── */}
        <div className="flex w-1/2 flex-col gap-3">
          <div className="flex items-center justify-between">
            <Typography.Text type="secondary" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Prompt
            </Typography.Text>
            {prompt && (
              <Tooltip title="Copy prompt">
                <Button
                  size="small"
                  type="text"
                  icon={<CopyOutlined />}
                  onClick={() => {
                    void navigator.clipboard.writeText(prompt);
                  }}
                />
              </Tooltip>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <Input.TextArea
              value={prompt}
              readOnly
              autoSize={{ minRows: 6, maxRows: 24 }}
              style={{ fontSize: 12 }}
            />
          </div>
        </div>
      </div>
    </Drawer>
  );
}
