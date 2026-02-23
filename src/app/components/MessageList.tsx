"use client";

import { useEffect, useRef } from "react";
import { Alert, Empty, Spin, Tag, Typography } from "antd";
import { RobotOutlined } from "@ant-design/icons";
import type { ChatMessage } from "../types";
import { MessageBubble } from "./MessageBubble";

/* ---- Helpers ---- */

export function mergeStreamingSummaries(summaries: string[]): string {
  const tools: string[] = [];
  const skills: string[] = [];
  for (const s of summaries) {
    const toolMatch = s.match(/^调用了工具：(.+)$/);
    if (toolMatch) {
      const name = toolMatch[1];
      if (name && !tools.includes(name)) tools.push(name);
      continue;
    }
    const skillMatch = s.match(/^使用了 skill[：:](.+)$/);
    if (skillMatch) {
      const name = skillMatch[1];
      if (name && !skills.includes(name)) skills.push(name);
      continue;
    }
    if (s === "使用了 skill") {
      if (!skills.includes("skill")) skills.push("skill");
    }
  }
  const parts: string[] = [];
  if (tools.length > 0) parts.push(`调用了工具：${tools.join("、")}`);
  if (skills.length > 0) parts.push(`使用了 skill：${skills.join("、")}`);
  return parts.join(" · ");
}

/* ---- Component ---- */

export interface MessageListProps {
  messages: ChatMessage[];
  isLoadingSession: boolean;
  error: string | null;
  streamingReply: string | null;
  streamingTools: string[];
}

export function MessageList({
  messages,
  isLoadingSession,
  error,
  streamingReply,
  streamingTools,
}: MessageListProps) {
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingReply, streamingTools]);

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4">
      {error && (
        <Alert type="error" message={error} showIcon closable style={{ marginBottom: 12 }} />
      )}
      {isLoadingSession ? (
        <div className="flex items-center justify-center py-8">
          <Spin description="Loading…" />
        </div>
      ) : messages.filter((m) => m.role !== "tool").length === 0 ? (
        <Empty description="Send a message to start." style={{ margin: "32px 0" }} />
      ) : (
        <div className="space-y-3">
          {messages
            .filter((m) => m.role !== "tool")
            .map((msg, idx) => (
              <MessageBubble key={`${msg.role}-${idx}`} message={msg} />
            ))}
          {streamingReply !== null && (
            <div className="rounded border border-emerald-500/40 bg-emerald-500/10 px-3 py-2">
              <div className="mb-1">
                <Tag color="green" icon={<RobotOutlined />} style={{ fontSize: 10 }}>Assistant</Tag>
              </div>
              {streamingReply.length > 0 ? (
                <Typography.Paragraph
                  style={{ marginBottom: 0, fontSize: 12, lineHeight: 1.7, whiteSpace: "pre-wrap" }}
                >
                  {streamingReply}
                </Typography.Paragraph>
              ) : (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>Streaming…</Typography.Text>
              )}
              {streamingTools.length > 0 && (
                <div className="mt-2 rounded border border-slate-800 bg-slate-950/70 px-2 py-1.5 text-[10px] text-slate-200">
                  {mergeStreamingSummaries(streamingTools)}
                </div>
              )}
            </div>
          )}
          <div ref={endRef} />
        </div>
      )}
    </div>
  );
}
