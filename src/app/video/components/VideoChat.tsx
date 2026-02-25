"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Button, Input, Alert } from "antd";
import { SendOutlined, StopOutlined, LoadingOutlined } from "@ant-design/icons";
import { StatusBadge } from "@/app/components/StatusBadge";
import { MessageList } from "@/app/components/MessageList";
import { useVideoChat } from "../hooks/useVideoChat";
import type { KeyResourceItem } from "@/app/types";
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
  /** Notify parent when key resources change. */
  onKeyResourcesChange?: (resources: KeyResourceItem[]) => void;
  /** Expose key resource CRUD to parent. */
  onKeyResourceHandlers?: (handlers: {
    update: (id: string, data: unknown, title?: string) => Promise<void>;
    delete: (id: string) => Promise<void>;
  }) => void;
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
  onKeyResourcesChange,
  onKeyResourceHandlers,
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

  // Notify parent of key resources changes
  const krChangeRef = useRef(onKeyResourcesChange);
  krChangeRef.current = onKeyResourcesChange;
  useEffect(() => {
    krChangeRef.current?.(chat.keyResources);
  }, [chat.keyResources]);

  // Expose handlers once
  const handlersRef = useRef(onKeyResourceHandlers);
  handlersRef.current = onKeyResourceHandlers;
  useEffect(() => {
    handlersRef.current?.({
      update: chat.updateKeyResource,
      delete: chat.deleteKeyResource,
    });
  }, [chat.updateKeyResource, chat.deleteKeyResource]);

  const [isComposing, setIsComposing] = useState(false);

  const handleSend = useCallback(() => {
    void chat.sendMessage();
  }, [chat]);

  if (!videoContext) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-slate-500">
        Select an episode to start chatting
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col border-t border-slate-800 bg-slate-950/60">
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
      <footer className="border-t border-slate-800 px-3 py-2">
        <div className="flex items-end gap-2">
          <Input.TextArea
            autoSize={{ minRows: 1, maxRows: 4 }}
            placeholder="Chat with video agent…"
            value={chat.input}
            onChange={(e) => chat.setInput(e.target.value)}
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
                handleSend();
              }
            }}
            onCompositionStart={() => setIsComposing(true)}
            onCompositionEnd={() => setIsComposing(false)}
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
                disabled={chat.isSending || chat.input.trim().length === 0}
              />
            )}
          </div>
        </div>
      </footer>
    </div>
  );
}
