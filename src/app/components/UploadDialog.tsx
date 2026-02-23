"use client";

import { Modal, Input, Alert, Typography, Upload, Button } from "antd";
import { UploadOutlined } from "@ant-design/icons";
import type { UploadRequestPayload } from "../types";

export interface UploadDialogProps {
  dialog: UploadRequestPayload;
  uploadProgress: string | null;
  onDialogChange: (req: UploadRequestPayload | null) => void;
  onExecute: (req: UploadRequestPayload, file: File) => void;
  onCancel: (req: UploadRequestPayload) => void;
  onError: (msg: string) => void;
}

export function UploadDialog({
  dialog,
  uploadProgress,
  onDialogChange,
  onExecute,
  onCancel,
  onError,
}: UploadDialogProps) {
  return (
    <Modal
      title={dialog.purpose || "上传文件"}
      open
      onCancel={() => onCancel(dialog)}
      footer={
        <Button onClick={() => onCancel(dialog)} disabled={!!uploadProgress}>
          取消
        </Button>
      }
      width={400}
      mask={{ closable: !uploadProgress }}
    >
      <div className="space-y-3">
        <div>
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>Endpoint</Typography.Text>
          <Input
            size="small"
            value={dialog.endpoint}
            onChange={(e) => onDialogChange({ ...dialog, endpoint: e.target.value })}
            placeholder="https://..."
            style={{ marginTop: 4 }}
          />
        </div>
        {dialog.maxSizeMB && (
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
            最大: {dialog.maxSizeMB}MB
          </Typography.Text>
        )}
        {uploadProgress ? (
          <Alert type="info" message={uploadProgress} showIcon />
        ) : (
          <Upload
            accept={dialog.accept || undefined}
            maxCount={1}
            beforeUpload={(file) => {
              if (dialog.maxSizeMB && file.size > dialog.maxSizeMB * 1024 * 1024) {
                onError(`文件超过 ${dialog.maxSizeMB}MB 限制`);
                return Upload.LIST_IGNORE;
              }
              if (!dialog.endpoint.trim()) {
                onError("请填写 endpoint");
                return Upload.LIST_IGNORE;
              }
              onExecute(dialog, file);
              return false;
            }}
          >
            <Button icon={<UploadOutlined />}>选择文件</Button>
          </Upload>
        )}
      </div>
    </Modal>
  );
}
