"use client";

import { Tag, Typography, Image } from "antd";
import {
  UserOutlined,
  RobotOutlined,
  SettingOutlined,
  ToolOutlined,
} from "@ant-design/icons";
import type { ChatMessage, ToolCall } from "../types";
import { parseJsonObject } from "./client-utils";

/* ---- Helpers ---- */

function summarizeToolCalls(calls: ToolCall[]): string {
  const tools: string[] = [];
  const skills: string[] = [];
  for (const call of calls) {
    const name = call.function.name;
    if (name.startsWith("skills__")) {
      const parsed = parseJsonObject(call.function.arguments);
      const skillName = parsed && typeof parsed.name === "string" ? parsed.name : "skill";
      if (!skills.includes(skillName)) skills.push(skillName);
    } else {
      if (!tools.includes(name)) tools.push(name);
    }
  }
  const parts: string[] = [];
  if (tools.length > 0) parts.push(`调用了工具：${tools.join("、")}`);
  if (skills.length > 0) parts.push(`使用了 skill：${skills.join("、")}`);
  return parts.join(" · ");
}

const roleConfig: Record<
  ChatMessage["role"],
  { label: string; color: string; icon: React.ReactNode; tone: string }
> = {
  user: { label: "User", color: "default", icon: <UserOutlined />, tone: "border-slate-700 bg-slate-900/60" },
  assistant: { label: "Assistant", color: "green", icon: <RobotOutlined />, tone: "border-emerald-500/40 bg-emerald-500/10" },
  system: { label: "System", color: "orange", icon: <SettingOutlined />, tone: "border-amber-500/40 bg-amber-500/10" },
  tool: { label: "Tool", color: "blue", icon: <ToolOutlined />, tone: "border-sky-500/40 bg-sky-500/10" },
};

/* ---- Component ---- */

export interface MessageBubbleProps {
  message: ChatMessage;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const cfg = roleConfig[message.role];
  return (
    <div className={`rounded border px-3 py-2 ${cfg.tone}`}>
      <div className="mb-1">
        <Tag color={cfg.color} icon={cfg.icon} style={{ fontSize: 10 }}>
          {cfg.label}
        </Tag>
      </div>
      {message.content ? (
        <Typography.Paragraph
          style={{ marginBottom: 0, fontSize: 12, lineHeight: 1.7, whiteSpace: "pre-wrap" }}
        >
          {message.content}
        </Typography.Paragraph>
      ) : (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>No content</Typography.Text>
      )}
      {message.images && message.images.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          <Image.PreviewGroup>
            {message.images.map((url, i) => (
              <Image
                key={i}
                src={url}
                alt={`Image ${i + 1}`}
                height={96}
                style={{ maxWidth: 160, objectFit: "cover", borderRadius: 4 }}
              />
            ))}
          </Image.PreviewGroup>
        </div>
      )}
      {message.role === "assistant" && message.tool_calls && message.tool_calls.length > 0 && (
        <div className="mt-2 rounded border border-slate-800 bg-slate-950/70 px-2 py-1.5 text-[10px] text-slate-200">
          {summarizeToolCalls(message.tool_calls)}
        </div>
      )}
    </div>
  );
}
