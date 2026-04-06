/**
 * style_preset MCP — read-only tools for discovering and inspecting style presets.
 *
 * Tools: list_styles, get_style
 */

import { z } from "zod";
import type { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types";
import type { McpProvider } from "../types";
import * as stylePresetService from "@/lib/services/style-preset-service";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function text(t: string): CallToolResult {
  return { content: [{ type: "text", text: t }] };
}

function json(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

/* ------------------------------------------------------------------ */
/*  Zod Schemas                                                        */
/* ------------------------------------------------------------------ */

const GetStyleParams = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
}).refine(
  (d) => d.id || d.name,
  { message: "Either id or name must be provided" },
);

/* ------------------------------------------------------------------ */
/*  Tool Definitions                                                   */
/* ------------------------------------------------------------------ */

const TOOLS: Tool[] = [
  {
    name: "list_styles",
    description:
      "List all available style presets. Returns [{id, name, prompt, referenceImageUrl}]. " +
      "Use this to discover which styles are available before calling generate_* tools with styleId.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "get_style",
    description:
      "Get a single style preset by id or name. " +
      "Returns {id, name, prompt, referenceImageUrl}.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "string", description: "Style preset ID" },
        name: { type: "string", description: "Style preset name (alternative to id)" },
      },
    },
  },
];

/* ------------------------------------------------------------------ */
/*  Provider                                                           */
/* ------------------------------------------------------------------ */

export const stylePresetMcp: McpProvider = {
  name: "style_preset",

  async listTools(): Promise<Tool[]> {
    return TOOLS;
  },

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<CallToolResult> {
    switch (name) {
      case "list_styles": {
        const presets = await stylePresetService.list();
        return json(
          presets.map((p) => ({
            id: p.id,
            name: p.name,
            prompt: p.prompt,
            referenceImageUrl: p.referenceImageUrl,
          })),
        );
      }

      case "get_style": {
        const params = GetStyleParams.parse(args);
        const preset = params.id
          ? await stylePresetService.getById(params.id)
          : await stylePresetService.getByName(params.name!);
        if (!preset) return text("Style preset not found");
        return json({
          id: preset.id,
          name: preset.name,
          prompt: preset.prompt,
          referenceImageUrl: preset.referenceImageUrl,
        });
      }

      default:
        return text(`Unknown tool: ${name}`);
    }
  },
};
