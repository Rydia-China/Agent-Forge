import OpenAI from "openai";
import type {
  ChatCompletionTool,
  ChatCompletionChunk,
} from "openai/resources/chat/completions";
import type { Stream } from "openai/streaming";
import type { Tool } from "@modelcontextprotocol/sdk/types";
import { DEFAULT_MODEL } from "./models";

/* ------------------------------------------------------------------ */
/*  First-Token Timeout (TTFT)                                         */
/* ------------------------------------------------------------------ */

const FIRST_TOKEN_TIMEOUT_MS =
  Math.max(1000, parseInt(process.env.FIRST_TOKEN_TIMEOUT_MS ?? "60000", 10)) || 60_000;

export { FIRST_TOKEN_TIMEOUT_MS };

/**
 * Thrown when the LLM stream does not produce its first chunk within the
 * TTFT deadline. NOT transient — should fail the task immediately.
 */
export class FirstTokenTimeoutError extends Error {
  constructor(timeoutMs: number = FIRST_TOKEN_TIMEOUT_MS) {
    super(`LLM 首 token 超时（${timeoutMs / 1000}s 内未收到响应），请重试`);
    this.name = "FirstTokenTimeoutError";
  }
}

/* ------------------------------------------------------------------ */
/*  Singleton client                                                  */
/* ------------------------------------------------------------------ */

const g = globalThis as unknown as { __llmClient?: OpenAI };

function getClient(): OpenAI {
  if (!g.__llmClient) {
    g.__llmClient = new OpenAI({
      apiKey: process.env.LLM_API_KEY ?? "",
      baseURL: process.env.LLM_BASE_URL || undefined,
      timeout: 5 * 60_000,   // 5 min per-request timeout
      maxRetries: 2,          // retry on connection errors (initial connect)
    });
  }
  return g.__llmClient;
}

/* ------------------------------------------------------------------ */
/*  Convert MCP Tool → OpenAI function tool                           */
/* ------------------------------------------------------------------ */

export function mcpToolToOpenAI(tool: Tool): ChatCompletionTool {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description ?? "",
      parameters: tool.inputSchema as Record<string, unknown>,
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Chat completions                                                  */
/* ------------------------------------------------------------------ */

export type LlmMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

export async function chatCompletion(
  messages: LlmMessage[],
  tools?: ChatCompletionTool[],
  model?: string,
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  const client = getClient();
  return client.chat.completions.create({
    model: model ?? DEFAULT_MODEL,
    messages,
    tools: tools?.length ? tools : undefined,
  });
}

export async function chatCompletionStream(
  messages: LlmMessage[],
  tools?: ChatCompletionTool[],
  signal?: AbortSignal,
  model?: string,
): Promise<Stream<ChatCompletionChunk>> {
  const client = getClient();
  return client.chat.completions.create(
    {
      model: model ?? DEFAULT_MODEL,
      messages,
      tools: tools?.length ? tools : undefined,
      stream: true,
      stream_options: { include_usage: true },
    },
    signal ? { signal } : undefined,
  );
}

/** Check if an error is a transient network issue worth retrying. */
export function isTransientStreamError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err instanceof FirstTokenTimeoutError) return false;
  const msg = err.message;
  const cause = (err as { cause?: Error }).cause;
  const causeCode = (cause as { code?: string } | undefined)?.code;
  return (
    msg === "terminated" ||
    causeCode === "ETIMEDOUT" ||
    causeCode === "ECONNRESET" ||
    causeCode === "EPIPE" ||
    causeCode === "UND_ERR_SOCKET" ||
    msg.includes("network") ||
    msg.includes("socket hang up")
  );
}

/* ------------------------------------------------------------------ */
/*  Streaming collect (with TTFT)                                      */
/* ------------------------------------------------------------------ */

interface CollectedToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface CollectedCompletion {
  content: string | null;
  tool_calls: CollectedToolCall[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Streaming chat completion collected into a single result.
 *
 * Uses streaming internally so the TTFT timeout applies:
 * if the first chunk is not received within `FIRST_TOKEN_TIMEOUT_MS`,
 * a `FirstTokenTimeoutError` is thrown.
 *
 * Designed for callers that don't need incremental output (e.g. SubAgent).
 */
export async function chatCompletionCollect(
  messages: LlmMessage[],
  tools?: ChatCompletionTool[],
  model?: string,
): Promise<CollectedCompletion> {
  const stream = await chatCompletionStream(messages, tools, undefined, model);

  let firstChunkReceived = false;
  let ttftFired = false;
  const ttftTimer = setTimeout(() => {
    ttftFired = true;
    stream.controller.abort();
  }, FIRST_TOKEN_TIMEOUT_MS);

  let content = "";
  const tcMap = new Map<number, CollectedToolCall>();
  let usage: CollectedCompletion["usage"];

  try {
    for await (const chunk of stream) {
      if (!firstChunkReceived) {
        firstChunkReceived = true;
        clearTimeout(ttftTimer);
      }
      if (chunk.usage) usage = chunk.usage;
      const choice = chunk.choices[0];
      if (!choice) continue;
      if (choice.delta.content) content += choice.delta.content;
      if (choice.delta.tool_calls) {
        for (const tc of choice.delta.tool_calls) {
          const idx = tc.index;
          if (typeof idx !== "number") continue;
          const existing = tcMap.get(idx) ?? {
            id: "",
            type: "function" as const,
            function: { name: "", arguments: "" },
          };
          if (tc.id) existing.id = tc.id;
          if (tc.function?.name) existing.function.name = tc.function.name;
          if (tc.function?.arguments)
            existing.function.arguments += tc.function.arguments;
          tcMap.set(idx, existing);
        }
      }
    }
    clearTimeout(ttftTimer);
  } catch (err) {
    clearTimeout(ttftTimer);
    stream.controller.abort();
    if (ttftFired) throw new FirstTokenTimeoutError();
    throw err;
  }

  return {
    content: content || null,
    tool_calls: Array.from(tcMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([, tc]) => tc),
    usage,
  };
}

/* ------------------------------------------------------------------ */
/*  Title generation (cheap model, fire-and-forget)                    */
/* ------------------------------------------------------------------ */

function getTitleModel(): string {
  return process.env.LLM_TITLE_MODEL || DEFAULT_MODEL;
}

export async function generateTitle(userMessage: string): Promise<string> {
  const client = getClient();
  const model = getTitleModel();
  const res = await client.chat.completions.create({
    model,
    messages: [
      {
        role: "system",
        content:
          "You generate short titles for chat conversations. Max 20 chars. Output the title only. No quotes. No trailing punctuation.",
      },
      {
        role: "user",
        content: `Generate a title for this message:\n${userMessage}`,
      },
    ],
  });
  return res.choices[0]?.message.content?.trim() || "New Chat";
}
