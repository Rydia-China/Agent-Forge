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

const PromptNameParams = z.object({
  name: z.string().min(1, "prompt name is required"),
});

const CompilePromptParams = z.object({
  name: z.string().min(1, "prompt name is required"),
  variables: z.record(z.string(), z.string()).default({}),
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
          "Get a prompt template by name from Langfuse. Returns the raw template with {{variable}} placeholders.",
        inputSchema: {
          type: "object" as const,
          properties: {
            name: { type: "string", description: "Prompt name" },
          },
          required: ["name"],
        },
      },
      {
        name: "compile_prompt",
        description:
          "Fetch a Langfuse prompt and compile it by replacing {{variable}} placeholders with provided values. Returns the final prompt ready for subagent execution.",
        inputSchema: {
          type: "object" as const,
          properties: {
            name: { type: "string", description: "Prompt name" },
            variables: {
              type: "object",
              description: "Key-value pairs to replace {{variable}} placeholders in the template",
              additionalProperties: { type: "string" },
            },
          },
          required: ["name"],
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
        const { name: promptName } = PromptNameParams.parse(args);
        const raw = await langfuseFetch(
          `/api/public/v2/prompts/${encodeURIComponent(promptName)}`,
        );
        const parsed = PromptDetailSchema.parse(raw);
        return json({
          name: parsed.name,
          version: parsed.version,
          labels: parsed.labels,
          template: extractTemplate(parsed),
        });
      }

      case "compile_prompt": {
        const { name: promptName, variables } =
          CompilePromptParams.parse(args);
        const raw = await langfuseFetch(
          `/api/public/v2/prompts/${encodeURIComponent(promptName)}`,
        );
        const parsed = PromptDetailSchema.parse(raw);
        const compiled = compileTemplate(extractTemplate(parsed), variables);
        return json({
          name: parsed.name,
          version: parsed.version,
          compiledPrompt: compiled,
        });
      }

      default:
        return text(`Unknown tool: ${name}`);
    }
  },
};
