"use client";

import { useState } from "react";
import { Button, Typography } from "antd";
import { AppstoreOutlined } from "@ant-design/icons";
import type { AgentStatus } from "./StatusBadge";
import { useChat } from "./hooks/useChat";
import { useModels } from "./hooks/useModels";
import { useImageUpload } from "./hooks/useImageUpload";
import { useFileUpload } from "./hooks/useFileUpload";
import { MessageList } from "./MessageList";
import { ChatInput } from "./ChatInput";
import { UploadDialog } from "./UploadDialog";
import { ImageLightbox } from "./ImageLightbox";
import { LlmStatsBar } from "./LlmStatsBar";

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

export interface AgentPanelProps {
  initialSessionId?: string;
  userName: string;
  onStatusChange: (status: AgentStatus) => void;
  onSessionCreated: (sessionId: string) => void;
  onTitleChange: (title: string) => void;
  onRefreshNeeded: () => void;
  showMcp: boolean;
  onToggleMcp: () => void;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function AgentPanel({
  initialSessionId,
  userName,
  onStatusChange,
  onSessionCreated,
  onTitleChange,
  onRefreshNeeded,
  showMcp,
  onToggleMcp,
}: AgentPanelProps) {
  const { models, selectedModel, setSelectedModel } = useModels();

  const chat = useChat(
    initialSessionId,
    userName,
    onSessionCreated,
    onTitleChange,
    onRefreshNeeded,
    onStatusChange,
    selectedModel,
  );

  const imageUpload = useImageUpload((msg) => chat.setError(msg));

  const fileUpload = useFileUpload(
    chat.sessionIdRef,
    chat.setUploadDialog,
    chat.setStatus,
    chat.setError,
    chat.reloadSession,
  );

  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  const displayTitle =
    chat.title?.trim() || (chat.sessionId ? "Untitled" : "New session");

  return (
    <div className="relative flex h-full min-w-[400px] flex-1 flex-col border-r border-slate-800 last:border-r-0">
      {/* Header */}
      <header className="flex items-center justify-between gap-2 border-b border-slate-800 px-4 py-3">
        <div className="min-w-0 flex-1">
          <Typography.Text strong ellipsis style={{ display: "block", fontSize: 18 }}>
            {displayTitle}
          </Typography.Text>
          <Typography.Text type="secondary" ellipsis style={{ display: "block", fontSize: 14 }}>
            {chat.sessionId ? chat.sessionId.slice(0, 12) + "…" : "Not created"}
          </Typography.Text>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            size="small"
            type={showMcp ? "primary" : "default"}
            ghost={showMcp}
            icon={<AppstoreOutlined />}
            onClick={onToggleMcp}
            title="切换 MCP 面板"
          >
            MCP
          </Button>
        </div>
      </header>

      {/* Content area: chat + key resources */}
      <div className="flex min-h-0 flex-1">
        {/* Chat column */}
        <div className="relative flex min-w-0 flex-1 flex-col">
          <MessageList
            messages={chat.messages}
            isLoadingSession={chat.isLoadingSession}
            error={chat.error}
            streamingReply={chat.streamingReply}
            streamingTools={chat.streamingTools}
            activeTools={chat.activeTools}
            subagentTasks={chat.subagentTasks}
          />
          <ChatInput
            input={chat.input}
            setInput={chat.setInput}
            isSending={chat.isSending}
            isStreaming={chat.isStreaming}
            pendingImages={imageUpload.pendingImages}
            setPendingImages={imageUpload.setPendingImages}
            isProcessing={imageUpload.isProcessing}
            isDragOver={imageUpload.isDragOver}
            setIsDragOver={imageUpload.setIsDragOver}
            isComposingRef={imageUpload.isComposingRef}
            handleImageFiles={imageUpload.handleImageFiles}
            fileInputRef={imageUpload.fileInputRef}
            sendMessage={() => {
              const imgs = imageUpload.pendingImages.slice();
              imageUpload.setPendingImages([]);
              void chat.sendMessage(imgs.length > 0 ? imgs : undefined);
            }}
            stopStreaming={chat.stopStreaming}
            openManualUpload={fileUpload.openManualUpload}
            uploadDialogOpen={!!chat.uploadDialog}
            models={models}
            selectedModel={selectedModel}
            onModelChange={setSelectedModel}
          />
          {/* LLM stats floating badge */}
          <LlmStatsBar stats={chat.llmStats} />
        </div>
      </div>

      {/* Upload dialog */}
      {chat.uploadDialog && (
        <UploadDialog
          dialog={chat.uploadDialog}
          uploadProgress={fileUpload.uploadProgress}
          onDialogChange={chat.setUploadDialog}
          onExecute={(req, file) => void fileUpload.executeUpload(req, file)}
          onCancel={(req) => void fileUpload.cancelUpload(req)}
          onError={(msg) => chat.setError(msg)}
        />
      )}

      {/* Image lightbox */}
      {lightboxUrl && (
        <ImageLightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />
      )}
    </div>
  );
}
