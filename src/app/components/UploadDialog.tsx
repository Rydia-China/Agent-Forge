"use client";

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
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-lg border border-slate-700 bg-slate-900 p-4 shadow-2xl">
        <div className="mb-3 text-sm font-semibold text-slate-100">
          {dialog.purpose || "上传文件"}
        </div>
        <div className="space-y-2">
          <div>
            <label className="mb-1 block text-[10px] text-slate-400">Endpoint</label>
            <input
              className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100"
              value={dialog.endpoint}
              onChange={(e) =>
                onDialogChange({ ...dialog, endpoint: e.target.value })
              }
              placeholder="https://..."
            />
          </div>
          {dialog.maxSizeMB && (
            <div className="text-[10px] text-slate-400">
              最大: {dialog.maxSizeMB}MB
            </div>
          )}
          {uploadProgress ? (
            <div className="rounded border border-sky-500/40 bg-sky-500/10 px-2 py-1.5 text-xs text-sky-100">
              {uploadProgress}
            </div>
          ) : (
            <input
              type="file"
              accept={dialog.accept || undefined}
              className="w-full text-xs text-slate-300 file:mr-2 file:rounded file:border-0 file:bg-slate-700 file:px-2 file:py-1 file:text-xs file:text-slate-100"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                if (dialog.maxSizeMB && file.size > dialog.maxSizeMB * 1024 * 1024) {
                  onError(`文件超过 ${dialog.maxSizeMB}MB 限制`);
                  return;
                }
                if (!dialog.endpoint.trim()) {
                  onError("请填写 endpoint");
                  return;
                }
                onExecute(dialog, file);
              }}
            />
          )}
        </div>
        <div className="mt-3 flex justify-end">
          <button
            className="rounded border border-slate-700 px-3 py-1 text-xs text-slate-300 hover:border-slate-500"
            onClick={() => onCancel(dialog)}
            type="button"
            disabled={!!uploadProgress}
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
