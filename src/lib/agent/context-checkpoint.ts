import { chatCompletion, type LlmMessage } from "./llm-client";
import { SUBAGENT_DEFAULT_MODEL } from "./models";
import type { ChatMessage } from "./types";

/* ------------------------------------------------------------------ */
/*  Context checkpoint — lossy compression when context exceeds 70%    */
/*                                                                     */
/*  Trigger: prompt_tokens > 0.7 * maxContextTokens                   */
/*  Effect: replaces session.messages with compressed version          */
/*  Irreversible — no recall mechanism                                 */
/* ------------------------------------------------------------------ */

/** How many recent "rounds" to keep verbatim. */
const KEEP_RECENT_ROUNDS = 3;

/** Threshold ratio — trigger compression above this. */
export const CHECKPOINT_THRESHOLD = 0.7;

/* ------------------------------------------------------------------ */
/*  Round splitting                                                    */
/* ------------------------------------------------------------------ */

/**
 * Split messages into { toCompress, toKeep }.
 * A "round" starts at each user message.
 * Last KEEP_RECENT_ROUNDS rounds are kept verbatim.
 */
export function splitForCheckpoint(messages: readonly ChatMessage[]): {
  toCompress: ChatMessage[];
  toKeep: ChatMessage[];
} {
  const userIndices: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i]!.role === "user") userIndices.push(i);
  }

  // Not enough rounds to compress
  if (userIndices.length <= KEEP_RECENT_ROUNDS) {
    return { toCompress: [], toKeep: [...messages] };
  }

  const splitIdx = userIndices[userIndices.length - KEEP_RECENT_ROUNDS]!;
  return {
    toCompress: messages.slice(0, splitIdx) as ChatMessage[],
    toKeep: messages.slice(splitIdx) as ChatMessage[],
  };
}

/* ------------------------------------------------------------------ */
/*  Compression prompt                                                 */
/* ------------------------------------------------------------------ */

const COMPRESS_SYSTEM = `你是一个对话压缩助手。将给定的对话历史压缩为结构化摘要。

## 规则
1. **用户输入** — 保留每条用户消息的原始文本（逐条列出，不可省略）
2. **助手回复** — 压缩为关键结论和决策，省略推理过程
3. **关键数据** — 提取并保留所有 URL、资源 ID、文件路径、配置值、生成结果
4. **变更记录** — 记录所有已执行的操作（工具调用的结果摘要）
5. **不要遗漏任何影响后续对话的状态信息**

## 输出格式（Markdown）
\`\`\`
## 用户请求历史
1. [原始用户输入1]
2. [原始用户输入2]
...

## 关键数据
- key: value
...

## 已执行操作
- 操作描述 → 结果摘要
...

## 对话摘要
[压缩的对话流程和决策]
\`\`\``;

/**
 * Serialize messages into a text block for the compression LLM.
 * User messages are kept verbatim; assistant/tool are summarized inline.
 */
function serializeForCompression(messages: readonly ChatMessage[]): string {
  const lines: string[] = [];
  for (const msg of messages) {
    if (msg.role === "user") {
      lines.push(`[User] ${msg.content ?? "(empty)"}`);
    } else if (msg.role === "assistant") {
      const text = msg.content ?? "";
      const tools = msg.tool_calls?.map((tc) => tc.function.name).join(", ");
      if (tools) {
        lines.push(`[Assistant] ${text ? text + " " : ""}(tools: ${tools})`);
      } else if (text) {
        lines.push(`[Assistant] ${text}`);
      }
    } else if (msg.role === "tool") {
      // Truncate long tool results — the LLM only needs key info
      const content = msg.content ?? "";
      const truncated = content.length > 500
        ? content.slice(0, 500) + `… (+${content.length - 500} chars)`
        : content;
      lines.push(`[Tool:${msg.tool_call_id ?? "?"}] ${truncated}`);
    }
  }
  return lines.join("\n");
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Compress older messages into a checkpoint summary.
 * Returns new session messages: [checkpoint_msg, ...recentMessages].
 *
 * The checkpoint message is a hidden user message so the LLM sees it
 * as context but the UI doesn't display it.
 */
export async function compressToCheckpoint(
  messages: readonly ChatMessage[],
): Promise<ChatMessage[] | null> {
  const { toCompress, toKeep } = splitForCheckpoint(messages);
  if (toCompress.length === 0) return null; // nothing to compress

  const serialized = serializeForCompression(toCompress);

  const llmMessages: LlmMessage[] = [
    { role: "system", content: COMPRESS_SYSTEM },
    { role: "user", content: `以下是需要压缩的对话历史：\n\n${serialized}` },
  ];

  try {
    const completion = await chatCompletion(
      llmMessages,
      undefined, // no tools
      SUBAGENT_DEFAULT_MODEL,
    );

    const summary = completion.choices[0]?.message.content?.trim();
    if (!summary) return null;

    const checkpointMsg: ChatMessage = {
      role: "user",
      content: `[context-checkpoint] 以下是之前对话的压缩摘要，完整历史已被压缩。\n\n${summary}`,
      hidden: true,
    };

    console.log(
      `[checkpoint] Compressed ${toCompress.length} messages → ${summary.length} chars, keeping ${toKeep.length} recent messages`,
    );

    return [checkpointMsg, ...toKeep];
  } catch (err) {
    console.error("[checkpoint] Compression failed, skipping:", err);
    return null; // fail-safe: don't compress if LLM call fails
  }
}
