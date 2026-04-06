import OpenAI from "openai";
import type {
  ChatCompletionTool,
  ChatCompletionChunk,
} from "openai/resources/chat/completions";
import type { Stream } from "openai/streaming";
import type { Tool } from "@modelcontextprotocol/sdk/types";
import { DEFAULT_MODEL } from "./models";

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
