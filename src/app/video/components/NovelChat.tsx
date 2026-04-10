"use client";

import { useCallback } from "react";
import { Button, Input, Select, Alert } from "antd";
import { SendOutlined, StopOutlined, PictureOutlined, CloseCircleFilled } from "@ant-design/icons";
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
  /** Show empty-state CTA when no sessions exist yet. */
  showEmptyState?: boolean;
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
  showEmptyState,
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

  const isEmpty = showEmptyState && !chat.isLoadingSession && chat.messages.length === 0 && !chat.isSending;

  return (
    <div className="flex h-full bg-slate-950/60">
      {/* Chat column */}
      <div className="relative flex min-w-0 flex-1 flex-col">
        {/* Header */}

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

        {isEmpty ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4">
            <div className="text-center">
              <div className="text-base font-medium text-slate-200">📚 小说资源管理</div>
              <div className="mt-1 text-xs text-slate-400">开始与 AI 协作，生成角色、场景等小说级资源</div>
            </div>
            <Button
              type="primary"
              size="large"
              onClick={() => void chat.sendDirect("开始生成小说级资源")}
            >
              开始生成小说级资源
            </Button>
            <div className="text-xs text-slate-500">或直接在下方输入开始自由对话</div>
          </div>
        ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <MessageList
            messages={chat.messages}
            isLoadingSession={chat.isLoadingSession}
            error={null}
            streamingReply={chat.streamingReply}
            streamingTools={chat.streamingTools}
            activeTools={chat.activeTools}
            subagentTasks={chat.subagentTasks}
          />
        </div>
        )}


        {/* Input — always visible */}
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
                    style={{ fontSize: 28 }}
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
              <PictureOutlined style={{ fontSize: 28 }} />
            </button>
            <Input.TextArea
              autoSize={{ minRows: 1, maxRows: 4 }}
              placeholder={img.isDragOver ? "松开以上传图片…" : "Chat with novel resource manager…"}
              value={chat.input}
              onChange={(e) => chat.setInput(e.target.value)}
            onKeyDown={(e) => {
                if (img.isComposingRef.current) return;
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
              onCompositionStart={() => { img.isComposingRef.current = true; }}
              onCompositionEnd={() => { img.isComposingRef.current = false; }}
              disabled={chat.isSending}
              variant="borderless"
              style={{ fontSize: 16 }}
            />
            <div className="flex shrink-0 items-center gap-1.5 pb-0.5">
              {models.length > 1 && (
                <Select
                  size="small"
                  value={selectedModel || undefined}
                  onChange={setSelectedModel}
                  options={models.map((m) => ({ value: m.id, label: m.label }))}
                  style={{ minWidth: 80, fontSize: 14 }}
                  disabled={chat.isSending || chat.isStreaming}
                />
              )}
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
                  disabled={chat.isSending || (!chat.input.trim() && img.pendingImages.length === 0)}
                />
              )}
            </div>
          </div>
        </footer>

        {/* LLM stats bar */}
        <LlmStatsBar stats={chat.llmStats} />
      </div>
    </div>
  );
}
