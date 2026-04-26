"use client";

import { Drawer, Button, Alert, Spin, Typography, Space } from "antd";
import { DeleteOutlined } from "@ant-design/icons";
import type { UseResourceDetailReturn } from "./hooks/useResourceDetail";
import { SkillEditor } from "./SkillEditor";

export interface ResourceDetailDrawerProps {
  detail: UseResourceDetailReturn;
}

export function ResourceDetailDrawer({ detail }: ResourceDetailDrawerProps) {
  const showDelete =
    detail.selectedResource?.type === "skill" &&
    detail.skillDetail &&
    !detail.skillDetail.isProduction;

  return (
    <Drawer
      title={
        detail.selectedResource ? (
          <Space>
            <Typography.Text strong>
              {detail.selectedResource.type === "skill" ? "Skill" : "MCP"}
            </Typography.Text>
            <Typography.Text type="secondary">·</Typography.Text>
            <Typography.Text>{detail.selectedResource.name}</Typography.Text>
          </Space>
        ) : "Detail"
      }
      placement="right"
      styles={{ wrapper: { width: '90vw' }, body: { maxWidth: 1400 } }}
      open={!!detail.selectedResource}
      onClose={() => detail.setSelectedResource(null)}
      extra={
        showDelete ? (
          <Button
            danger
            icon={<DeleteOutlined />}
            loading={detail.isDeletingResource}
            onClick={() => void detail.deleteSelectedResource()}
          >
            Delete
          </Button>
        ) : null
      }
    >
      {detail.error && <Alert type="error" title={detail.error} showIcon closable style={{ marginBottom: 12 }} />}
      {detail.notice && <Alert type="success" title={detail.notice} showIcon closable style={{ marginBottom: 12 }} />}

      {detail.isLoadingResourceDetail ? (
        <div className="flex items-center justify-center py-12">
          <Spin description="Loading…" />
        </div>
      ) : detail.selectedResource?.type === "skill" && detail.skillDetail ? (
        <SkillEditor
          detail={detail.skillDetail}
          versions={detail.skillVersions}
          edit={detail.skillEdit}
          setEdit={detail.setSkillEdit}
          isSaving={detail.isSavingResource}
          isPublishing={detail.isPublishingVersion}
          onSave={() => void detail.saveSkillVersion()}
          onPublish={(v) => void detail.publishSkillVersion(v)}
        />
      ) : (
        <Typography.Text type="secondary">No detail loaded.</Typography.Text>
      )}
    </Drawer>
  );
}
