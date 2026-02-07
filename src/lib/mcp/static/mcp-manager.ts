import type { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types";
import type { McpProvider } from "../types";
import { registry } from "../registry";
import * as svc from "@/lib/services/mcp-service";

function text(t: string): CallToolResult {
  return { content: [{ type: "text", text: t }] };
}

function json(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

/** Zod schema for update_code (subset of McpUpdateParams with code required) */
const McpUpdateCodeParams = svc.McpUpdateParams.required({ code: true });

export const mcpManagerMcp: McpProvider = {
  name: "mcp_manager",

  async listTools(): Promise<Tool[]> {
    return [
      {
        name: "list",
        description: "List all registered MCP servers (both static in-memory and dynamic from DB).",
        inputSchema: { type: "object" as const, properties: {} },
      },
      {
        name: "get_code",
        description: "Get the JavaScript source code of a dynamic MCP server.",
        inputSchema: {
          type: "object" as const,
          properties: { name: { type: "string", description: "MCP server name" } },
          required: ["name"],
        },
      },
      {
        name: "create",
        description: "Create a new dynamic MCP server. The code must be JavaScript and will run in a sandboxed environment.",
        inputSchema: {
          type: "object" as const,
          properties: {
            name: { type: "string" },
            description: { type: "string" },
            code: { type: "string", description: "JavaScript source implementing listTools() and callTool(name, args)" },
            enabled: { type: "boolean", description: "Default: true" },
          },
          required: ["name", "code"],
        },
      },
      {
        name: "update_code",
        description: "Update the code (and optionally description) of an existing dynamic MCP server.",
        inputSchema: {
          type: "object" as const,
          properties: {
            name: { type: "string" },
            code: { type: "string" },
            description: { type: "string" },
          },
          required: ["name", "code"],
        },
      },
      {
        name: "toggle",
        description: "Enable or disable a dynamic MCP server.",
        inputSchema: {
          type: "object" as const,
          properties: { name: { type: "string" }, enabled: { type: "boolean" } },
          required: ["name", "enabled"],
        },
      },
      {
        name: "delete",
        description: "Delete a dynamic MCP server from DB and unregister it from the runtime registry.",
        inputSchema: {
          type: "object" as const,
          properties: { name: { type: "string" } },
          required: ["name"],
        },
      },
      {
        name: "reload",
        description: "Reload a dynamic MCP server — re-reads code from DB and re-registers in sandbox.",
        inputSchema: {
          type: "object" as const,
          properties: { name: { type: "string" } },
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
      case "list": {
        const runtime = registry.listProviders().map((p) => ({ name: p.name, source: "runtime" }));
        const database = await svc.listMcpServers();
        return json({ runtime, database });
      }
      case "get_code": {
        const { name: n } = svc.McpNameParams.parse(args);
        const code = await svc.getMcpCode(n);
        if (code === null) return text(`MCP server "${n}" not found in DB`);
        return text(code);
      }
      case "create": {
        const params = svc.McpCreateParams.parse(args);
        const { record, loadError } = await svc.createMcpServer(params);
        if (loadError) return text(`Created MCP server "${record.name}" but sandbox load failed: ${loadError}`);
        if (!record.enabled) return text(`Created MCP server "${record.name}" (disabled)`);
        return text(`Created and loaded MCP server "${record.name}"`);
      }
      case "update_code": {
        const params = McpUpdateCodeParams.parse(args);
        const { record } = await svc.updateMcpServer(params);
        return text(`Updated MCP server "${record.name}". Use reload to apply changes.`);
      }
      case "toggle": {
        const params = svc.McpToggleParams.parse(args);
        const record = await svc.toggleMcpServer(params);
        return text(`MCP server "${record.name}" is now ${record.enabled ? "enabled" : "disabled"}`);
      }
      case "delete": {
        const { name: n } = svc.McpNameParams.parse(args);
        await svc.deleteMcpServer(n);
        return text(`Deleted MCP server "${n}"`);
      }
      case "reload": {
        const { name: n } = svc.McpNameParams.parse(args);
        const msg = await svc.reloadMcpServer(n);
        return text(msg);
      }
      default:
        return text(`Unknown tool: ${name}`);
    }
  },
};
