"use client";

import { Button, Card, Input, Tag, Typography } from "antd";
import { SaveOutlined } from "@ant-design/icons";
import type { SkillDetail, SkillVersionSummary } from "../types";
import { VersionList } from "./VersionList";

export interface SkillEditorProps {
  detail: SkillDetail;
  versions: SkillVersionSummary[];
  edit: { description: string; content: string; tags: string };
  setEdit: React.Dispatch<React.SetStateAction<{ description: string; content: string; tags: string }>>;
  isSaving: boolean;
  isPublishing: boolean;
  onSave: () => void;
  onPublish: (version: number) => void;
}

export function SkillEditor({
  detail,
  versions,
  edit,
  setEdit,
  isSaving,
  isPublishing,
  onSave,
  onPublish,
}: SkillEditorProps) {
  const isBuiltin = versions.length === 0;

  return (
    <div className={isBuiltin ? "space-y-4" : "grid gap-6 lg:grid-cols-[2fr_1fr]"}>
      <div className="space-y-4">
        <Card size="small">
          <Typography.Text strong>{detail.name}</Typography.Text>
          {!isBuiltin && (
            <div><Typography.Text type="secondary" style={{ fontSize: 12 }}>Production v{detail.productionVersion}</Typography.Text></div>
          )}
          {detail.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {detail.tags.map((t) => (
                <Tag key={t}>{t}</Tag>
              ))}
            </div>
          )}
        </Card>
        <Card size="small">
          <div className="space-y-3">
            <div>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>Description</Typography.Text>
              <Input.TextArea
                rows={4}
                value={edit.description}
                readOnly={isBuiltin}
                onChange={isBuiltin ? undefined : (e) => setEdit((p) => ({ ...p, description: e.target.value }))}
                style={{ marginTop: 4 }}
              />
            </div>
            <div>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>Content</Typography.Text>
              <Input.TextArea
                rows={16}
                value={edit.content}
                readOnly={isBuiltin}
                onChange={isBuiltin ? undefined : (e) => setEdit((p) => ({ ...p, content: e.target.value }))}
                style={{ marginTop: 4 }}
              />
            </div>
            {!isBuiltin && (
              <>
                <div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>Tags</Typography.Text>
                  <Input
                    value={edit.tags}
                    onChange={(e) => setEdit((p) => ({ ...p, tags: e.target.value }))}
                    placeholder="tag-a, tag-b"
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
              </>
            )}
          </div>
        </Card>
      </div>
      {!isBuiltin && (
        <Card size="small" title="Versions">
          <VersionList versions={versions} isPublishing={isPublishing} onPublish={onPublish} />
        </Card>
      )}
    </div>
  );
}
