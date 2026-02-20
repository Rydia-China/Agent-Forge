import { z } from "zod";
import OpenAI from "openai";
import type { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types";
import type { McpProvider } from "../types";

function text(t: string): CallToolResult {
  return { content: [{ type: "text", text: t }] };
}

function json(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
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
  tasks: z.array(
    z.object({
      prompt: z.string().min(1),
      model: z.string().min(1),
      imageUrls: z.array(z.string().url()).optional(),
    }),
  ).min(1, "tasks array must not be empty"),
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
          "Execute prompt(s) on specified model(s) via subagent. Accepts an array of tasks; all tasks run concurrently. For a single prompt, pass a one-element array. Each result includes status (ok/error) so partial failures are handled gracefully.",
        inputSchema: {
          type: "object" as const,
          properties: {
            tasks: {
              type: "array",
              description: "Array of prompt tasks to execute concurrently",
              items: {
                type: "object",
                properties: {
                  prompt: { type: "string", description: "The compiled prompt to execute" },
                  model: {
                    type: "string",
                    description: "Model name (e.g. 'google/gemini-3.1-pro-preview'). Required — no default.",
                  },
                  imageUrls: {
                    type: "array",
                    items: { type: "string" },
                    description: "Optional image URLs for multimodal prompts (vision tasks)",
                  },
                },
                required: ["prompt", "model"],
              },
            },
          },
          required: ["tasks"],
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
        const { tasks } = RunTextParams.parse(args);
        const client = getClient();

        type MessageContent =
          | string
          | Array<
              | { type: "text"; text: string }
              | { type: "image_url"; image_url: { url: string } }
            >;

        const results = await Promise.allSettled(
          tasks.map(async (task) => {
            let content: MessageContent;
            if (task.imageUrls && task.imageUrls.length > 0) {
              content = [
                { type: "text", text: task.prompt },
                ...task.imageUrls.map((url) => ({
                  type: "image_url" as const,
                  image_url: { url },
                })),
              ];
            } else {
              content = task.prompt;
            }

            const res = await client.chat.completions.create({
              model: task.model,
              messages: [{ role: "user", content }],
            });
            return res.choices[0]?.message.content ?? "";
          }),
        );

        const output = results.map((r, i) =>
          r.status === "fulfilled"
            ? { index: i, status: "ok" as const, result: r.value }
            : { index: i, status: "error" as const, error: r.reason instanceof Error ? r.reason.message : String(r.reason) },
        );
        return json(output);
      }

      default:
        return text(`Unknown tool: ${name}`);
    }
  },
};
