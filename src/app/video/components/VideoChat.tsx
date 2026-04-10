"use client";

import { useCallback } from "react";
import { App, Button, Input, Select, Alert } from "antd";
import { SendOutlined, StopOutlined, PictureOutlined, CloseCircleFilled, PlayCircleOutlined, WarningOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { StatusBadge } from "@/app/components/StatusBadge";
import { MessageList } from "@/app/components/MessageList";
import { useImageUpload } from "@/app/components/hooks/useImageUpload";
import { useModels } from "@/app/components/hooks/useModels";
import { useVideoChat } from "../hooks/useVideoChat";
import { LlmStatsBar } from "@/app/components/LlmStatsBar";
import type { VideoContext, EpStatus } from "../types";

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

export interface VideoChatProps {
  /** undefined = new session */
  initialSessionId: string | undefined;
  videoContext: VideoContext | null;
  skills: string[];
  onSessionCreated: (sessionId: string) => void;
  /** Called when task completes — parent should refresh data. */
  onRefreshNeeded: () => void;
  /** Current episode status — shows "Start Task" button when "uploaded". */
  episodeStatus?: EpStatus;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function VideoChat({
  initialSessionId,
  videoContext,
  skills,
  onSessionCreated,
  onRefreshNeeded,
  episodeStatus,
}: VideoChatProps) {
  const { modal } = App.useApp();
  const userName = videoContext
    ? `video:${videoContext.novelId}:${videoContext.scriptKey}`
    : "video:unknown";

  const { models, selectedModel, setSelectedModel } = useModels();

  const chat = useVideoChat(
    initialSessionId,
    userName,
    videoContext,
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

  /** Start task with optional yolo flag — checks novel resources first. */
  const handleStartTask = useCallback((yolo: boolean) => {
    const prompt = yolo
      ? "以 yolo 模式开始处理本集视频制作"
      : "开始处理本集视频制作";

    void (async () => {
      try {
        const res = await fetch(`/api/video/novel/${videoContext!.novelId}/resources`);
        if (!res.ok) { void chat.sendDirect(prompt); return; }
        const data = (await res.json()) as { categories: Array<{ category: string; items: Array<{ title: string | null; currentVersion: number }> }> };

        const portraits = data.categories.find((c) => c.category === "角色立绘");
        const scenes = data.categories.find((c) => c.category === "场景");
        const missingChars = (portraits?.items ?? []).filter((i) => i.currentVersion === 0).map((i) => i.title ?? "?");
        const missingScenes = (scenes?.items ?? []).filter((i) => i.currentVersion === 0).map((i) => i.title ?? "?");

        if (missingChars.length > 0 || missingScenes.length > 0) {
          const items: React.ReactNode[] = [];
          if (missingChars.length > 0) {
            const total = portraits?.items.length ?? 0;
            items.push(<div key="char">1. 角色立绘 {total - missingChars.length}/{total}，缺少：{missingChars.join("、")}</div>);
          }
          if (missingScenes.length > 0) {
            const total = scenes?.items.length ?? 0;
            items.push(<div key="scene">{missingChars.length > 0 ? 2 : 1}. 场景图片 {total - missingScenes.length}/{total}，缺少：{missingScenes.join("、")}</div>);
          }
          modal.confirm({
            title: "小说资源尚未全部完成",
            icon: <WarningOutlined />,
            content: <>{items}</>,
            okText: "仍然开始",
            cancelText: "稍后再说",
            onOk: () => void chat.sendDirect(prompt),
          });
        } else {
          void chat.sendDirect(prompt);
        }
      } catch {
        void chat.sendDirect(prompt);
      }
    })();
  }, [chat, modal, videoContext]);

  if (!videoContext) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-slate-500">
        Select an episode to start chatting
      </div>
    );
  }

  return (
    <div className="flex h-full bg-slate-950/60">
      {/* Chat column */}
      <div className="relative flex min-w-0 flex-1 flex-col">
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
            activeTools={chat.activeTools}
            subagentTasks={chat.subagentTasks}
          />
        </div>


      {/* Start task button — only when episode uploaded & no session yet */}
      {episodeStatus === "uploaded" && !initialSessionId && chat.messages.length === 0 && !chat.isSending && (
        <div className="flex items-center justify-center gap-2 border-b border-slate-800 px-3 py-3">
          <Button
            type="primary"
            size="large"
            icon={<PlayCircleOutlined />}
            onClick={() => handleStartTask(false)}
          >
            开始任务
          </Button>
          <Button
            size="large"
            icon={<ThunderboltOutlined />}
            onClick={() => handleStartTask(true)}
            style={{ borderColor: "#faad14", color: "#faad14" }}
          >
            YOLO
          </Button>
          {models.length > 1 && (
            <Select
              size="large"
              value={selectedModel || undefined}
              onChange={setSelectedModel}
              options={models.map((m) => ({ value: m.id, label: m.label }))}
              style={{ minWidth: 120 }}
            />
          )}
          <span className="text-xs text-slate-500">或直接在下方输入</span>
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
                disabled={chat.isSending || (chat.input.trim().length === 0 && img.pendingImages.length === 0)}
              />
            )}
          </div>
          </div>
      </footer>
        {/* LLM stats floating badge */}
        <LlmStatsBar stats={chat.llmStats} />
      </div>

    </div>
  );
}
