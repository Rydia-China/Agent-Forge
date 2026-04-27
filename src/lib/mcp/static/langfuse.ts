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
          "列出 Langfuse 中的所有 prompt 模板（仅名称和元数据，不含内容）。用于发现可用的 prompt。",
        inputSchema: { type: "object" as const, properties: {} },
      },
      {
        name: "compile_prompts",
        description:
          "获取并编译 Langfuse prompt，替换 {{variable}} 占位符。并发处理多个 prompt，返回编译后的内容。单个 prompt 也需要用数组格式。",
        inputSchema: {
          type: "object" as const,
          properties: {
            items: {
              type: "array",
              description: "要编译的 prompt 数组",
              items: {
                type: "object",
                properties: {
                  name: { type: "string", description: "Prompt 名称" },
                  variables: {
                    type: "object",
                    description: "用于替换 {{variable}} 占位符的键值对",
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

      case "compile_prompts": {
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
