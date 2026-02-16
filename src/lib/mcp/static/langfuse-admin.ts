import { z } from "zod";
import type { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types";
import type { McpProvider } from "../types";
import {
  langfuseFetch,
  extractTemplate,
  PromptListResponseSchema,
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

const PromptNameParams = z.object({
  name: z.string().min(1, "prompt name is required"),
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
          "List all prompts in Langfuse with metadata (names, versions, labels, tags).",
        inputSchema: { type: "object" as const, properties: {} },
      },
      {
        name: "get_prompt",
        description:
          "Get a prompt template by name. Returns the full template content, version, and labels.",
        inputSchema: {
          type: "object" as const,
          properties: {
            name: { type: "string", description: "Prompt name" },
          },
          required: ["name"],
        },
      },
      {
        name: "create_prompt",
        description:
          "Create a new prompt or push a new version of an existing prompt. If the name already exists, a new version is created. Set labels to [\"production\"] to deploy immediately.",
        inputSchema: {
          type: "object" as const,
          properties: {
            name: {
              type: "string",
              description: "Prompt name (use workflow__step__type convention)",
            },
            prompt: {
              type: "string",
              description:
                "Prompt template content. Use {{variableName}} for variable placeholders.",
            },
            labels: {
              type: "array",
              items: { type: "string" },
              description:
                'Labels for this version (e.g. ["production"], ["staging"]). Omit to create without deploying.',
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
        const raw = await langfuseFetch("/api/public/v2/prompts");
        const parsed = PromptListResponseSchema.parse(raw);
        const list = parsed.data.map((p) => ({
          name: p.name,
          versions: p.versions,
          labels: p.labels,
          tags: p.tags,
        }));
        return json(list);
      }

      case "get_prompt": {
        const { name: promptName } = PromptNameParams.parse(args);
        const raw = await langfuseFetch(
          `/api/public/v2/prompts/${encodeURIComponent(promptName)}`,
        );
        const parsed = PromptDetailSchema.parse(raw);
        return json({
          name: parsed.name,
          version: parsed.version,
          labels: parsed.labels,
          tags: parsed.tags,
          template: extractTemplate(parsed),
        });
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
