import OpenAI from "openai";
import type { ChatCompletionTool } from "openai/resources/chat/completions";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

/* ------------------------------------------------------------------ */
/*  Singleton client                                                  */
/* ------------------------------------------------------------------ */

const g = globalThis as unknown as { __llmClient?: OpenAI };

function getClient(): OpenAI {
  if (!g.__llmClient) {
    g.__llmClient = new OpenAI({
      apiKey: process.env.LLM_API_KEY ?? "",
      baseURL: process.env.LLM_BASE_URL || undefined,
    });
  }
  return g.__llmClient;
}

export function getModel(): string {
  return process.env.LLM_MODEL ?? "gpt-4o";
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
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  const client = getClient();
  return client.chat.completions.create({
    model: getModel(),
    messages,
    tools: tools?.length ? tools : undefined,
  });
}
