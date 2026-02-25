"use client";

import { useCallback } from "react";
import { Button, Input, Alert } from "antd";
import { SendOutlined, StopOutlined, LoadingOutlined, PictureOutlined, CloseCircleFilled } from "@ant-design/icons";
import { StatusBadge } from "@/app/components/StatusBadge";
import { MessageList } from "@/app/components/MessageList";
import { useImageUpload } from "@/app/components/hooks/useImageUpload";
import { useVideoChat } from "../hooks/useVideoChat";
import type { VideoContext } from "../types";

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

export interface VideoChatProps {
  /** undefined = new session */
  initialSessionId: string | undefined;
  videoContext: VideoContext | null;
  preloadMcps: string[];
  skills: string[];
  onSessionCreated: (sessionId: string) => void;
  /** Called when task completes — parent should refresh data. */
  onRefreshNeeded: () => void;
  /** If set, auto-send this message on mount (e.g. after EP upload). */
  autoMessage?: string;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function VideoChat({
  initialSessionId,
  videoContext,
  preloadMcps,
  skills,
  onSessionCreated,
  onRefreshNeeded,
  autoMessage,
}: VideoChatProps) {
  const userName = videoContext
    ? `video:${videoContext.novelId}:${videoContext.scriptKey}`
    : "video:unknown";

  const chat = useVideoChat(
    initialSessionId,
    userName,
    videoContext,
    preloadMcps,
    skills,
    onSessionCreated,
    onRefreshNeeded,
    autoMessage,
  );

  const img = useImageUpload((msg) => chat.setError(msg));

  const handleSend = useCallback(() => {
    const images = img.pendingImages.length > 0 ? [...img.pendingImages] : undefined;
    img.setPendingImages([]);
    void chat.sendMessage(images);
  }, [chat, img]);

  if (!videoContext) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-slate-500">
        Select an episode to start chatting
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-slate-950/60">
      {/* Chat error */}
      {chat.error && (
        <Alert
          type="error"
          message={chat.error}
          showIcon
          closable
          onClose={() => chat.setError(null)}
          style={{ margin: "4px 8px 0" }}
          banner
        />
      )}

      {/* Messages */}
      <div className="flex min-h-0 flex-1 flex-col">
        <MessageList
          messages={chat.messages}
          isLoadingSession={chat.isLoadingSession}
          error={null}
          streamingReply={chat.streamingReply}
          streamingTools={chat.streamingTools}
        />
      </div>

      {/* Active tool indicator */}
      {chat.activeTool && (
        <div className="flex items-center gap-2 border-t border-slate-800 bg-slate-900/60 px-3 py-1.5 text-[11px] text-slate-300">
          <LoadingOutlined className="text-blue-400" />
          <span className="truncate">{chat.activeTool.name}</span>
          <span className="shrink-0 text-slate-500">
            {chat.activeTool.index + 1}/{chat.activeTool.total}
          </span>
        </div>
      )}

      {/* Input */}
      <footer className="px-3 py-2.5">
        {/* Pending image previews */}
        {img.pendingImages.length > 0 && (
          <div className="mb-1.5 flex flex-wrap gap-1.5">
            {img.pendingImages.map((url, i) => (
              <div key={url} className="group relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt={`Pending ${i + 1}`} className="h-12 w-12 rounded border border-slate-700 object-cover" />
                <CloseCircleFilled
                  className="absolute -right-1 -top-1 cursor-pointer text-slate-400 opacity-0 transition group-hover:opacity-100 hover:text-rose-400"
                  style={{ fontSize: 14 }}
                  onClick={() => img.setPendingImages((prev) => prev.filter((_, idx) => idx !== i))}
                />
              </div>
            ))}
          </div>
        )}
        <div
          className={`flex items-end gap-2 rounded-xl border bg-slate-900/60 px-3 py-2 transition ${
            img.isDragOver ? "border-emerald-400 bg-emerald-500/10" : "border-slate-700"
          }`}
          onDragOver={(e) => { e.preventDefault(); img.setIsDragOver(true); }}
          onDragLeave={() => img.setIsDragOver(false)}
          onDrop={(e) => { e.preventDefault(); img.setIsDragOver(false); void img.handleImageFiles(Array.from(e.dataTransfer.files)); }}
        >
          {/* Hidden file input */}
          <input
            ref={img.fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => { void img.handleImageFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }}
          />
          <Button
            type="text"
            size="small"
            icon={<PictureOutlined />}
            onClick={() => img.fileInputRef.current?.click()}
            disabled={chat.isSending}
            className="shrink-0 !text-slate-400 hover:!text-slate-200"
          />
          <Input.TextArea
            autoSize={{ minRows: 1, maxRows: 4 }}
            placeholder={img.isDragOver ? "松开以上传图片…" : "Chat with video agent…"}
            value={chat.input}
            onChange={(e) => chat.setInput(e.target.value)}
            onKeyDown={(e) => {
              if (img.isComposing) return;
              const native = e.nativeEvent;
              const composing =
                typeof native === "object" &&
                native !== null &&
                "isComposing" in native &&
                (native as { isComposing?: boolean }).isComposing === true;
              if (composing) return;
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData.files);
              if (files.some((f) => f.type.startsWith("image/"))) {
                e.preventDefault();
                void img.handleImageFiles(files);
              }
            }}
            onCompositionStart={() => img.setIsComposing(true)}
            onCompositionEnd={() => img.setIsComposing(false)}
            disabled={chat.isSending}
            variant="borderless"
            style={{ fontSize: 12 }}
          />
          <div className="flex shrink-0 items-center gap-1.5 pb-0.5">
            <StatusBadge status={chat.status} />
            {chat.isStreaming ? (
              <Button
                danger
                type="primary"
                size="small"
                icon={<StopOutlined />}
                onClick={chat.stopStreaming}
              />
            ) : (
              <Button
                type="primary"
                size="small"
                icon={<SendOutlined />}
                onClick={handleSend}
                disabled={chat.isSending || (chat.input.trim().length === 0 && img.pendingImages.length === 0)}
              />
            )}
          </div>
        </div>
      </footer>
    </div>
  );
}
