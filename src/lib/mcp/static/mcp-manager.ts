import type { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types";
import { type McpProvider, type ToolContext, qualifyToolName } from "../types";
import { registry } from "../registry";

function text(t: string): CallToolResult {
  return { content: [{ type: "text", text: t }] };
}

function json(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

export const mcpManagerMcp: McpProvider = {
  name: "mcp_manager",

  async listTools(): Promise<Tool[]> {
    return [
      {
        name: "list",
        description: "List all active MCP servers.",
        inputSchema: { type: "object" as const, properties: { _noargs: { description: "unused placeholder (tool takes no arguments)", type: "string" } }, additionalProperties: false },
      },
      {
        name: "use",
        description: "Call a tool from an MCP provider. All providers are already loaded at init.",
        inputSchema: {
          type: "object" as const,
          properties: {
            provider: { type: "string", description: "MCP server name (e.g. 'biz_db', 'video_mgr', 'oss')" },
            tool: { type: "string", description: "Tool name within the MCP (e.g. 'sql', 'generate_image')" },
            args: {
              type: "object" as const,
              description: "Arguments to pass to the tool (same as if calling directly)",
              additionalProperties: true,
            },
          },
          required: ["provider", "tool"],
        },
      },
    ];
  },

  async callTool(
    name: string,
    args: Record<string, unknown>,
    context?: ToolContext,
  ): Promise<CallToolResult> {
    switch (name) {
      case "use": {
        const provider = args.provider as string | undefined;
        const tool = args.tool as string | undefined;
        const toolArgs = (args.args ?? {}) as Record<string, unknown>;
        if (!provider || !tool) return text("Missing required parameters: provider, tool");

        if (!registry.getProvider(provider)) {
          return text(`MCP "${provider}" not found. Use mcp_manager__list to see available providers.`);
        }

        return registry.callTool(qualifyToolName(provider, tool), toolArgs, context);
      }
      case "list": {
        const active = registry.listProviders().map((p) => p.name);
        return json({ active });
      }
      default:
        return text(`Unknown tool: ${name}`);
    }
  },
};
