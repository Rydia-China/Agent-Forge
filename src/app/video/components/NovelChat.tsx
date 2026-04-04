"use client";

import { useCallback } from "react";
import { Input, Select, Alert } from "antd";
import { SendOutlined, StopOutlined, LoadingOutlined, PictureOutlined, CloseCircleFilled } from "@ant-design/icons";
import { StatusBadge } from "@/app/components/StatusBadge";
import { MessageList } from "@/app/components/MessageList";
import { useImageUpload } from "@/app/components/hooks/useImageUpload";
import { useModels } from "@/app/components/hooks/useModels";
import { useNovelChat } from "../hooks/useNovelChat";
import { LlmStatsBar } from "@/app/components/LlmStatsBar";

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

export interface NovelChatProps {
  novelId: string;
  /** undefined = new session */
  initialSessionId: string | undefined;
  skills: string[];
  onSessionCreated: (sessionId: string) => void;
  /** Called when task completes — parent should refresh data. */
  onRefreshNeeded: () => void;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function NovelChat({
  novelId,
  initialSessionId,
  skills,
  onSessionCreated,
  onRefreshNeeded,
}: NovelChatProps) {
  const { models, selectedModel, setSelectedModel } = useModels();

  const chat = useNovelChat(
    initialSessionId,
    novelId,
    skills,
    onSessionCreated,
    onRefreshNeeded,
    selectedModel,
  );

  const img = useImageUpload((msg) => chat.setError(msg));

  const handleSend = useCallback(() => {
    const images = img.pendingImages.length > 0 ? [...img.pendingImages] : undefined;
    img.setPendingImages([]);
    void chat.sendMessage(images);
  }, [chat, img]);

  return (
    <div className="flex h-full bg-slate-950/60">
      {/* Chat column */}
      <div className="relative flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-slate-800 px-3 py-2">
          <div className="flex items-center gap-2 text-xs">
            <StatusBadge status={chat.status} />
            {chat.sessionId && (
              <span className="truncate text-slate-500">Session: {chat.sessionId.slice(0, 8)}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Select
              size="small"
              value={selectedModel}
              onChange={setSelectedModel}
              options={models.map((m) => ({ label: m, value: m }))}
              disabled={chat.isSending}
              style={{ width: 140, fontSize: 11 }}
            />
            {chat.isStreaming && (
              <button
                onClick={chat.stopStreaming}
                className="flex items-center gap-1 rounded bg-rose-600 px-2 py-0.5 text-[10px] text-white transition hover:bg-rose-700"
              >
                <StopOutlined style={{ fontSize: 10 }} />
                Stop
              </button>
            )}
          </div>
        </header>

        {/* Chat error */}
        {chat.error && (
          <Alert
            type="error"
            title={chat.error}
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
            subagentTasks={chat.subagentTasks}
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
            <button
              type="button"
              onClick={() => img.fileInputRef.current?.click()}
              disabled={chat.isSending}
              className="shrink-0 text-slate-400 hover:text-slate-200 disabled:opacity-50"
            >
              <PictureOutlined style={{ fontSize: 16 }} />
            </button>
            <Input.TextArea
              autoSize={{ minRows: 1, maxRows: 4 }}
              placeholder={img.isDragOver ? "松开以上传图片…" : "Chat with novel resource manager…"}
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
            <button
              type="button"
              onClick={handleSend}
              disabled={chat.isSending || (!chat.input.trim() && img.pendingImages.length === 0)}
              className="shrink-0 text-emerald-400 hover:text-emerald-300 disabled:opacity-30"
            >
              <SendOutlined style={{ fontSize: 16 }} />
            </button>
          </div>
        </footer>

        {/* LLM stats bar */}
        <LlmStatsBar stats={chat.llmStats} />
      </div>
    </div>
  );
}
