"use client";

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

const roleStyles: Record<
  ChatMessage["role"],
  { label: string; tone: string; chip: string }
> = {
  user: {
    label: "User",
    tone: "border-slate-700 bg-slate-900/60",
    chip: "bg-slate-700 text-slate-100",
  },
  assistant: {
    label: "Assistant",
    tone: "border-emerald-500/40 bg-emerald-500/10",
    chip: "bg-emerald-600 text-emerald-50",
  },
  system: {
    label: "System",
    tone: "border-amber-500/40 bg-amber-500/10",
    chip: "bg-amber-500 text-amber-950",
  },
  tool: {
    label: "Tool",
    tone: "border-sky-500/40 bg-sky-500/10",
    chip: "bg-sky-600 text-sky-50",
  },
};

/* ---- Component ---- */

export interface MessageBubbleProps {
  message: ChatMessage;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const style = roleStyles[message.role];
  return (
    <div className={`rounded border px-3 py-2 ${style.tone} fade-in`}>
      <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-300">
        <span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold ${style.chip}`}>
          {style.label}
        </span>
      </div>
      {message.content ? (
        <p className="whitespace-pre-wrap text-xs leading-relaxed text-slate-100">
          {message.content}
        </p>
      ) : (
        <p className="text-xs text-slate-400">No content</p>
      )}
      {message.images && message.images.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {message.images.map((url, i) => (
            <a key={i} href={url} target="_blank" rel="noopener noreferrer">
              <img
                src={url}
                alt={`Image ${i + 1}`}
                className="h-24 max-w-[160px] rounded border border-slate-700 object-cover hover:border-slate-500"
              />
            </a>
          ))}
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
