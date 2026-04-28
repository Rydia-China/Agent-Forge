import OpenAI from "openai";
import type {
  ChatCompletionTool,
  ChatCompletionChunk,
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
} from "openai/resources/chat/completions";
import type { Tool } from "@modelcontextprotocol/sdk/types";
import { DEFAULT_MODEL } from "./models";

/* ------------------------------------------------------------------ */
/*  Singleton client                                                  */
/* ------------------------------------------------------------------ */

const g = globalThis as unknown as { __llmClient?: OpenAI };

function getClient(): OpenAI {
  if (!g.__llmClient) {
    const apiKey = process.env.LLM_API_KEY;
    if (!apiKey || apiKey.trim() === "") {
      throw new Error(
        "LLM_API_KEY is not configured. Please set it in your .env file."
      );
    }
    g.__llmClient = new OpenAI({
      apiKey,
      baseURL: process.env.LLM_BASE_URL || undefined,
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

type LlmThinkingMode = "enabled" | "disabled";
type ThinkingRequest = { thinking?: { type: LlmThinkingMode } };
type JsonResponseFormat = { type: "json_object" };
type NonStreamingRequest = ChatCompletionCreateParamsNonStreaming & ThinkingRequest;
type StreamingRequest = ChatCompletionCreateParamsStreaming & ThinkingRequest;

export interface ChatCompletionOptions {
  responseFormat?: JsonResponseFormat;
}

function getThinkingMode(): LlmThinkingMode | undefined {
  const raw = process.env.LLM_THINKING_MODE?.trim().toLowerCase();
  if (raw === "enabled") return "enabled";
  if (raw === "provider-default") return undefined;
  return "disabled";
}

function applyThinkingMode(body: ThinkingRequest): void {
  const mode = getThinkingMode();
  if (mode) body.thinking = { type: mode };
}

export async function chatCompletion(
  messages: LlmMessage[],
  tools?: ChatCompletionTool[],
  model?: string,
  options?: ChatCompletionOptions,
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  const client = getClient();
  const body: NonStreamingRequest = {
    model: model ?? DEFAULT_MODEL,
    messages,
    tools: tools?.length ? tools : undefined,
    response_format: options?.responseFormat,
  };
  applyThinkingMode(body);
  const rawRes: unknown = await client.chat.completions.create(body);

  let res: ChatCompletion;
  if (typeof rawRes === "string") {
    try {
      res = JSON.parse(rawRes) as ChatCompletion;
    } catch (parseErr) {
      throw new Error(
        `Failed to parse chat completion string response: ${
          parseErr instanceof Error ? parseErr.message : String(parseErr)
        }`,
      );
    }
  } else {
    res = rawRes as ChatCompletion;
  }

  if (!res.choices || res.choices.length === 0) {
    throw new Error("No choices returned from LLM");
  }

  return res;
}

export async function chatCompletionStream(
  messages: LlmMessage[],
  tools?: ChatCompletionTool[],
  signal?: AbortSignal,
  model?: string,
): Promise<AsyncIterable<ChatCompletionChunk>> {
  const client = getClient();
  
  console.log("[llm-client] Creating stream with:", {
    model: model ?? DEFAULT_MODEL,
    messageCount: messages.length,
    toolCount: tools?.length ?? 0,
    baseURL: process.env.LLM_BASE_URL,
    thinkingMode: getThinkingMode() ?? "provider-default",
  });
  
  const body: StreamingRequest = {
    model: model ?? DEFAULT_MODEL,
    messages,
    tools: tools?.length ? tools : undefined,
    stream: true,
  };
  applyThinkingMode(body);
  const stream = await client.chat.completions.create(
    body,
    signal ? { signal } : undefined,
  );
  
  console.log("[llm-client] Stream created, type:", typeof stream);
  
  return stream;
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
  
  console.log("[generateTitle] Starting title generation", {
    model,
    messageLength: userMessage.length,
    messagePreview: userMessage.slice(0, 50),
  });
  
  try {
    const body: NonStreamingRequest = {
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
    };
    applyThinkingMode(body);
    const rawRes: unknown = await client.chat.completions.create(body);
    
    // Handle case where OpenAI SDK returns a string instead of object
    // This can happen with some OpenAI-compatible APIs
    let res: ChatCompletion;
    if (typeof rawRes === "string") {
      console.log("[generateTitle] Response is string, parsing JSON", {
        resPreview: rawRes.slice(0, 100),
      });
      try {
        res = JSON.parse(rawRes) as ChatCompletion;
      } catch (parseErr) {
        console.error("[generateTitle] Failed to parse string response", { 
          error: parseErr instanceof Error ? parseErr.message : String(parseErr),
        });
        return "New Chat";
      }
    } else {
      res = rawRes as ChatCompletion;
    }
    
    console.log("[generateTitle] LLM response received", {
      model,
      choicesCount: res.choices?.length ?? 0,
      hasContent: !!res.choices?.[0]?.message?.content,
    });
    
    if (!res.choices || res.choices.length === 0) {
      console.error("[generateTitle] No choices returned from LLM", { model });
      return "New Chat";
    }
    
    const content = res.choices[0]?.message?.content;
    if (!content) {
      console.error("[generateTitle] No content in first choice", { model });
      return "New Chat";
    }
    
    const title = content.trim() || "New Chat";
    console.log("[generateTitle] Title generated successfully", { title });
    return title;
  } catch (err: unknown) {
    console.error("[generateTitle] Error calling LLM", {
      model,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    return "New Chat";
  }
}
