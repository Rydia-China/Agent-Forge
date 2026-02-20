"use client";

import { Button, Tag, Typography, Empty } from "antd";
import { RocketOutlined } from "@ant-design/icons";
import { formatTimestamp } from "./client-utils";

export interface VersionItem {
  version: number;
  description: string | null;
  isProduction: boolean;
  createdAt: string;
}

export interface VersionListProps {
  versions: VersionItem[];
  isPublishing: boolean;
  onPublish: (version: number) => void;
}

export function VersionList({ versions, isPublishing, onPublish }: VersionListProps) {
  if (versions.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No versions." />;
  }
  return (
    <div className="space-y-3">
      {versions.map((v) => (
        <div
          key={v.version}
          className="rounded border border-slate-800 bg-slate-950/60 px-3 py-3"
        >
          <div className="flex items-center justify-between">
            <Typography.Text strong>v{v.version}</Typography.Text>
            {v.isProduction ? (
              <Tag color="green">Production</Tag>
            ) : (
              <Button
                type="link"
                size="small"
                icon={<RocketOutlined />}
                onClick={() => onPublish(v.version)}
                loading={isPublishing}
              >
                发布
              </Button>
            )}
          </div>
          <Typography.Text style={{ fontSize: 12, display: "block", marginTop: 4 }}>
            {v.description || "No description"}
          </Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
            {formatTimestamp(v.createdAt)}
          </Typography.Text>
        </div>
      ))}
    </div>
  );
}
