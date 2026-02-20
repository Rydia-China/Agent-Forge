"use client";

import { Button, Card, Input, Tag, Typography } from "antd";
import { SaveOutlined } from "@ant-design/icons";
import type { McpDetail, McpVersionSummary } from "../types";
import { VersionList } from "./VersionList";

export interface McpEditorProps {
  detail: McpDetail;
  versions: McpVersionSummary[];
  edit: { description: string; code: string };
  setEdit: React.Dispatch<React.SetStateAction<{ description: string; code: string }>>;
  isSaving: boolean;
  isPublishing: boolean;
  onSave: () => void;
  onPublish: (version: number) => void;
}

export function McpEditor({
  detail,
  versions,
  edit,
  setEdit,
  isSaving,
  isPublishing,
  onSave,
  onPublish,
}: McpEditorProps) {
  return (
    <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
      <div className="space-y-4">
        <Card size="small">
          <Typography.Text strong>{detail.name}</Typography.Text>
          <div><Typography.Text type="secondary" style={{ fontSize: 12 }}>Production v{detail.productionVersion}</Typography.Text></div>
          <Tag color={detail.enabled ? "green" : "default"} style={{ marginTop: 4 }}>
            {detail.enabled ? "Enabled" : "Disabled"}
          </Tag>
        </Card>
        <Card size="small">
          <div className="space-y-3">
            <div>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>Description</Typography.Text>
              <Input.TextArea
                rows={4}
                value={edit.description}
                onChange={(e) => setEdit((p) => ({ ...p, description: e.target.value }))}
                style={{ marginTop: 4 }}
              />
            </div>
            <div>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>Code</Typography.Text>
              <Input.TextArea
                rows={10}
                value={edit.code}
                onChange={(e) => setEdit((p) => ({ ...p, code: e.target.value }))}
                style={{ marginTop: 4 }}
              />
            </div>
            <div className="flex justify-end">
              <Button
                type="primary"
                icon={<SaveOutlined />}
                loading={isSaving}
                onClick={onSave}
              >
                提交新版本
              </Button>
            </div>
          </div>
        </Card>
      </div>
      <Card size="small" title="Versions">
        <VersionList versions={versions} isPublishing={isPublishing} onPublish={onPublish} />
      </Card>
    </div>
  );
}
