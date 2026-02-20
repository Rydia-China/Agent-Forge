"use client";

import { useState } from "react";
import { Button, Typography } from "antd";
import { PaperClipOutlined } from "@ant-design/icons";
import type { AgentStatus } from "./StatusBadge";
import { useChat } from "./hooks/useChat";
import { useImageUpload } from "./hooks/useImageUpload";
import { useFileUpload } from "./hooks/useFileUpload";
import { MessageList } from "./MessageList";
import { ChatInput } from "./ChatInput";
import { UploadDialog } from "./UploadDialog";
import { KeyResourcesPanel } from "./KeyResourcesPanel";
import { ImageLightbox } from "./ImageLightbox";

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
}: AgentPanelProps) {
  const chat = useChat(
    initialSessionId,
    userName,
    onSessionCreated,
    onTitleChange,
    onRefreshNeeded,
    onStatusChange,
  );

  const imageUpload = useImageUpload((msg) => chat.setError(msg));

  const fileUpload = useFileUpload(
    chat.sessionIdRef,
    chat.setUploadDialog,
    chat.setStatus,
    chat.setError,
    chat.reloadSession,
  );

  const [showKeyResources, setShowKeyResources] = useState(true);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  const displayTitle =
    chat.title?.trim() || (chat.sessionId ? "Untitled" : "New session");

  return (
    <div className="relative flex h-full min-w-[400px] flex-1 flex-col border-r border-slate-800 last:border-r-0">
      {/* Header */}
      <header className="flex items-center justify-between gap-2 border-b border-slate-800 px-4 py-3">
        <div className="min-w-0 flex-1">
          <Typography.Text strong ellipsis style={{ display: "block", fontSize: 14 }}>
            {displayTitle}
          </Typography.Text>
          <Typography.Text type="secondary" ellipsis style={{ display: "block", fontSize: 11 }}>
            {chat.sessionId ? chat.sessionId.slice(0, 12) + "…" : "Not created"}
          </Typography.Text>
        </div>
        {chat.keyResources.length > 0 && (
          <Button
            size="small"
            type={showKeyResources ? "primary" : "default"}
            ghost={showKeyResources}
            icon={<PaperClipOutlined />}
            onClick={() => setShowKeyResources((v) => !v)}
            title="切换关键资源面板"
          >
            {chat.keyResources.length}
          </Button>
        )}
      </header>

      {/* Content area: chat + key resources */}
      <div className="flex min-h-0 flex-1">
        {/* Chat column */}
        <div className="flex min-w-0 flex-1 flex-col">
          <MessageList
            messages={chat.messages}
            isLoadingSession={chat.isLoadingSession}
            error={chat.error}
            streamingReply={chat.streamingReply}
            streamingTools={chat.streamingTools}
          />
          <ChatInput
            input={chat.input}
            setInput={chat.setInput}
            isSending={chat.isSending}
            isStreaming={chat.isStreaming}
            pendingImages={imageUpload.pendingImages}
            setPendingImages={imageUpload.setPendingImages}
            isUploading={imageUpload.isUploading}
            isDragOver={imageUpload.isDragOver}
            setIsDragOver={imageUpload.setIsDragOver}
            isComposing={imageUpload.isComposing}
            setIsComposing={imageUpload.setIsComposing}
            handleImageFiles={imageUpload.handleImageFiles}
            fileInputRef={imageUpload.fileInputRef}
            sendMessage={() => void chat.sendMessage()}
            stopStreaming={chat.stopStreaming}
            openManualUpload={fileUpload.openManualUpload}
            uploadDialogOpen={!!chat.uploadDialog}
          />
        </div>

        {/* Key Resources panel */}
        {chat.keyResources.length > 0 && showKeyResources && (
          <KeyResourcesPanel
            keyResources={chat.keyResources}
            onImageClick={setLightboxUrl}
          />
        )}
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
