import { z } from "zod";
import OpenAI from "openai";
import type { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types";
import type { McpProvider } from "../types";

function text(t: string): CallToolResult {
  return { content: [{ type: "text", text: t }] };
}

/* ------------------------------------------------------------------ */
/*  OpenAI client (reuses main LLM proxy)                              */
/* ------------------------------------------------------------------ */

const g = globalThis as unknown as { __subagentClient?: OpenAI };

function getClient(): OpenAI {
  if (!g.__subagentClient) {
    const apiKey = process.env.LLM_API_KEY;
    if (!apiKey) throw new Error("LLM_API_KEY is not configured");
    g.__subagentClient = new OpenAI({
      apiKey,
      baseURL: process.env.LLM_BASE_URL || undefined,
    });
  }
  return g.__subagentClient;
}

/* ------------------------------------------------------------------ */
/*  Zod schemas                                                        */
/* ------------------------------------------------------------------ */

const RunTextParams = z.object({
  prompt: z.string().min(1, "prompt is required"),
  model: z.string().min(1, "model is required — specify the model name"),
  imageUrls: z.array(z.string().url()).optional(),
});

/* ------------------------------------------------------------------ */
/*  Provider                                                           */
/* ------------------------------------------------------------------ */

export const subagentMcp: McpProvider = {
  name: "subagent",

  async listTools(): Promise<Tool[]> {
    return [
      {
        name: "run_text",
        description:
          "Execute a prompt on a specified model (subagent). Use this to delegate prompt-driven tasks to smaller/cheaper models instead of handling them in the main controller. The model parameter is required — it should be determined by the relevant skill or workflow. Returns the raw text response.",
        inputSchema: {
          type: "object" as const,
          properties: {
            prompt: {
              type: "string",
              description: "The compiled prompt to execute",
            },
            model: {
              type: "string",
              description:
                "Model name to use (e.g. 'google/gemini-3-pro-preview', 'deepseek/deepseek-chat'). Required — no default.",
            },
            imageUrls: {
              type: "array",
              items: { type: "string" },
              description:
                "Optional image URLs for multimodal prompts (vision tasks)",
            },
          },
          required: ["prompt", "model"],
        },
      },
    ];
  },

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<CallToolResult> {
    switch (name) {
      case "run_text": {
        const { prompt, model, imageUrls } = RunTextParams.parse(args);
        const client = getClient();

        type MessageContent =
          | string
          | Array<
              | { type: "text"; text: string }
              | { type: "image_url"; image_url: { url: string } }
            >;

        let content: MessageContent;
        if (imageUrls && imageUrls.length > 0) {
          content = [
            { type: "text", text: prompt },
            ...imageUrls.map((url) => ({
              type: "image_url" as const,
              image_url: { url },
            })),
          ];
        } else {
          content = prompt;
        }

        const res = await client.chat.completions.create({
          model,
          messages: [{ role: "user", content }],
        });

        const reply = res.choices[0]?.message.content ?? "";
        return text(reply);
      }

      default:
        return text(`Unknown tool: ${name}`);
    }
  },
};
