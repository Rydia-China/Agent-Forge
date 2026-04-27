import OpenAI from "openai";
import type {
  ChatCompletionTool,
  ChatCompletionChunk,
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
): Promise<AsyncIterable<ChatCompletionChunk>> {
  const client = getClient();
  
  console.log("[llm-client] Creating stream with:", {
    model: model ?? DEFAULT_MODEL,
    messageCount: messages.length,
    toolCount: tools?.length ?? 0,
    baseURL: process.env.LLM_BASE_URL,
  });
  
  const stream = await client.chat.completions.create(
    {
      model: model ?? DEFAULT_MODEL,
      messages,
      tools: tools?.length ? tools : undefined,
      stream: true,
    },
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
    
    console.log("[generateTitle] LLM response received", {
      model,
      choicesCount: res.choices?.length ?? 0,
      hasContent: !!res.choices?.[0]?.message?.content,
    });
    
    if (!res.choices || res.choices.length === 0) {
      console.error("[generateTitle] No choices returned from LLM", { model, res });
      return "New Chat";
    }
    
    const content = res.choices[0]?.message?.content;
    if (!content) {
      console.error("[generateTitle] No content in first choice", { model, choice: res.choices[0] });
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
