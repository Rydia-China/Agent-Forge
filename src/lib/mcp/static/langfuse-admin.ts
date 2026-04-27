import { z } from "zod";
import type { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types";
import type { McpProvider } from "../types";
import {
  langfuseFetch,
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

const CreatePromptParams = z.object({
  name: z.string().min(1, "prompt name is required"),
  prompt: z.string().min(1, "prompt content is required"),
  labels: z.array(z.string()).optional(),
});

/* ------------------------------------------------------------------ */
/*  Provider                                                           */
/* ------------------------------------------------------------------ */

export const langfuseAdminMcp: McpProvider = {
  name: "langfuse_admin",

  async listTools(): Promise<Tool[]> {
    return [
      {
        name: "list_prompts",
        description:
          "列出 Langfuse 中的所有 prompt，包含元数据（名称、版本、标签）。",
        inputSchema: { type: "object" as const, properties: {} },
      },
      {
        name: "get_prompts",
        description:
          "根据名称获取 prompt 模板。返回完整模板内容、版本和标签。单个 prompt 也需要用数组格式。",
        inputSchema: {
          type: "object" as const,
          properties: {
            names: {
              type: "array",
              items: { type: "string" },
              description: "要获取的 prompt 名称数组",
            },
          },
          required: ["names"],
        },
      },
      {
        name: "create_prompt",
        description:
          "创建新 prompt 或推送现有 prompt 的新版本。如果名称已存在，会创建新版本。设置 labels 为 [\"production\"] 可立即部署。",
        inputSchema: {
          type: "object" as const,
          properties: {
            name: {
              type: "string",
              description: "Prompt 名称（建议使用 workflow__step__type 命名规范）",
            },
            prompt: {
              type: "string",
              description:
                "Prompt 模板内容。使用 {{variableName}} 作为变量占位符。",
            },
            labels: {
              type: "array",
              items: { type: "string" },
              description:
                '此版本的标签（如 ["production"], ["staging"]）。省略则创建但不部署。',
            },
          },
          required: ["name", "prompt"],
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
          versions: p.versions,
          labels: p.labels,
          tags: p.tags,
        }));
        return json(list);
      }

      case "get_prompts": {
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
              tags: parsed.tags,
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

      case "create_prompt": {
        const { name: promptName, prompt, labels } =
          CreatePromptParams.parse(args);
        const body: Record<string, unknown> = {
          name: promptName,
          prompt,
          type: "text",
        };
        if (labels) body.labels = labels;
        const raw = await langfuseFetch("/api/public/v2/prompts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const parsed = PromptDetailSchema.parse(raw);
        return text(
          `Prompt "${parsed.name}" v${parsed.version} created${parsed.labels?.includes("production") ? " (production)" : ""}`,
        );
      }

      default:
        return text(`Unknown tool: ${name}`);
    }
  },
};
