import { z } from "zod";
import type { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types";
import type { McpProvider } from "../types";
import {
  langfuseFetch,
  compileTemplate,
  extractTemplate,
  fetchAllPrompts,
  PromptDetailSchema,
} from "./langfuse-helpers";

function text(t: string): CallToolResult {
  return { content: [{ type: "text", text: t }] };
}

function json(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

/* ------------------------------------------------------------------ */
/*  Zod input schemas                                                  */
/* ------------------------------------------------------------------ */

const GetPromptParams = z.object({
  names: z.array(z.string().min(1)).min(1),
});

const CompilePromptParams = z.object({
  items: z.array(
    z.object({
      name: z.string().min(1),
      variables: z.record(z.string(), z.string()).default({}),
    }),
  ).min(1),
});

/* ------------------------------------------------------------------ */
/*  Provider                                                           */
/* ------------------------------------------------------------------ */

export const langfuseMcp: McpProvider = {
  name: "langfuse",

  async listTools(): Promise<Tool[]> {
    return [
      {
        name: "list_prompts",
        description:
          "List all prompts in Langfuse (names and metadata only, no content). Use to discover available prompt templates.",
        inputSchema: { type: "object" as const, properties: {} },
      },
      {
        name: "get_prompt",
        description:
          "Get prompt template(s) by name from Langfuse. Returns an array of results with raw template and {{variable}} placeholders. For a single prompt, pass a one-element array.",
        inputSchema: {
          type: "object" as const,
          properties: {
            names: {
              type: "array",
              items: { type: "string" },
              description: "Array of prompt names to fetch",
            },
          },
          required: ["names"],
        },
      },
      {
        name: "compile_prompt",
        description:
          "Fetch and compile Langfuse prompt(s) by replacing {{variable}} placeholders concurrently. Returns an array of compiled prompts ready for subagent execution. For a single prompt, pass a one-element array.",
        inputSchema: {
          type: "object" as const,
          properties: {
            items: {
              type: "array",
              description: "Array of prompts to compile",
              items: {
                type: "object",
                properties: {
                  name: { type: "string", description: "Prompt name" },
                  variables: {
                    type: "object",
                    description: "Key-value pairs to replace {{variable}} placeholders",
                    additionalProperties: { type: "string" },
                  },
                },
                required: ["name"],
              },
            },
          },
          required: ["items"],
        },
      },
    ];
  },

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<CallToolResult> {
    switch (name) {
      case "list_prompts": {
        const all = await fetchAllPrompts();
        const list = all.map((p) => ({
          name: p.name,
          labels: p.labels,
          tags: p.tags,
        }));
        return json(list);
      }

      case "get_prompt": {
        const { names } = GetPromptParams.parse(args);
        const results = await Promise.allSettled(
          names.map(async (promptName) => {
            const raw = await langfuseFetch(
              `/api/public/v2/prompts/${encodeURIComponent(promptName)}`,
            );
            const parsed = PromptDetailSchema.parse(raw);
            return {
              name: parsed.name,
              version: parsed.version,
              labels: parsed.labels,
              template: extractTemplate(parsed),
            };
          }),
        );
        const output = results.map((r, i) =>
          r.status === "fulfilled"
            ? { status: "ok" as const, ...r.value }
            : { status: "error" as const, name: names[i], error: r.reason instanceof Error ? r.reason.message : String(r.reason) },
        );
        return json(output);
      }

      case "compile_prompt": {
        const { items } = CompilePromptParams.parse(args);
        const results = await Promise.allSettled(
          items.map(async ({ name: promptName, variables }) => {
            const raw = await langfuseFetch(
              `/api/public/v2/prompts/${encodeURIComponent(promptName)}`,
            );
            const parsed = PromptDetailSchema.parse(raw);
            const compiled = compileTemplate(extractTemplate(parsed), variables);
            return {
              name: parsed.name,
              version: parsed.version,
              compiledPrompt: compiled,
            };
          }),
        );
        const output = results.map((r, i) =>
          r.status === "fulfilled"
            ? { status: "ok" as const, ...r.value }
            : { status: "error" as const, name: items[i]!.name, error: r.reason instanceof Error ? r.reason.message : String(r.reason) },
        );
        return json(output);
      }

      default:
        return text(`Unknown tool: ${name}`);
    }
  },
};
