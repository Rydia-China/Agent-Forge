"use client";

import { Button, Input, Space } from "antd";
import {
  PictureOutlined,
  UploadOutlined,
  SendOutlined,
  StopOutlined,
  CloseCircleFilled,
} from "@ant-design/icons";

export interface ChatInputProps {
  input: string;
  setInput: (v: string) => void;
  isSending: boolean;
  isStreaming: boolean;
  pendingImages: string[];
  setPendingImages: React.Dispatch<React.SetStateAction<string[]>>;
  isProcessing: boolean;
  isDragOver: boolean;
  setIsDragOver: (v: boolean) => void;
  isComposing: boolean;
  setIsComposing: (v: boolean) => void;
  handleImageFiles: (files: File[]) => Promise<void>;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  sendMessage: () => void;
  stopStreaming: () => void;
  openManualUpload: () => void;
  uploadDialogOpen: boolean;
}

export function ChatInput({
  input,
  setInput,
  isSending,
  isStreaming,
  pendingImages,
  setPendingImages,
  isProcessing,
  isDragOver,
  setIsDragOver,
  isComposing,
  setIsComposing,
  handleImageFiles,
  fileInputRef,
  sendMessage,
  stopStreaming,
  openManualUpload,
  uploadDialogOpen,
}: ChatInputProps) {
  return (
    <footer className="border-t border-slate-800 px-4 py-3">
      <div className="flex flex-col gap-2">
        {pendingImages.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {pendingImages.map((url, i) => (
              <div key={url} className="group relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt={`Pending ${i + 1}`}
                  className="h-12 w-12 rounded border border-slate-700 object-cover"
                />
                <CloseCircleFilled
                  className="absolute -right-1 -top-1 cursor-pointer text-slate-400 opacity-0 transition group-hover:opacity-100 hover:text-rose-400"
                  style={{ fontSize: 14 }}
                  onClick={() =>
                    setPendingImages((prev) => prev.filter((_, idx) => idx !== i))
                  }
                />
              </div>
            ))}
          </div>
        )}
        <div
          className={`relative rounded border transition ${isDragOver ? "border-emerald-400 bg-emerald-500/10" : "border-slate-700"}`}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragOver(true);
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragOver(false);
            void handleImageFiles(Array.from(e.dataTransfer.files));
          }}
        >
          <Input.TextArea
            variant="borderless"
            autoSize={{ minRows: 3, maxRows: 6 }}
            placeholder={isDragOver ? "松开以上传图片…" : "Type message… (Enter to send)"}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (isComposing) return;
              const native = e.nativeEvent;
              const composing =
                typeof native === "object" &&
                native !== null &&
                "isComposing" in native &&
                (native as { isComposing?: boolean }).isComposing === true;
              if (composing) return;
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData.files);
              if (files.some((f) => f.type.startsWith("image/"))) {
                e.preventDefault();
                void handleImageFiles(files);
              }
            }}
            onCompositionStart={() => setIsComposing(true)}
            onCompositionEnd={() => setIsComposing(false)}
            disabled={isSending}
          />
        </div>
        <div className="flex items-center justify-between">
          <Space size={8}>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                void handleImageFiles(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
            <Button
              size="small"
              icon={<PictureOutlined />}
              onClick={() => fileInputRef.current?.click()}
              disabled={isSending || isProcessing}
              loading={isProcessing}
            >
              图片
            </Button>
            <Button
              size="small"
              icon={<UploadOutlined />}
              onClick={openManualUpload}
              disabled={isSending || uploadDialogOpen}
              title="上传文件到指定接口"
            >
              文件
            </Button>
          </Space>
          {isStreaming ? (
            <Button
              danger
              type="primary"
              size="small"
              icon={<StopOutlined />}
              onClick={stopStreaming}
            >
              Stop
            </Button>
          ) : (
            <Button
              type="primary"
              size="small"
              icon={<SendOutlined />}
              onClick={sendMessage}
              disabled={isSending || (input.trim().length === 0 && pendingImages.length === 0)}
            >
              Send
            </Button>
          )}
        </div>
      </div>
    </footer>
  );
}
