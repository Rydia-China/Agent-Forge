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
        description: "Get the JavaScript source code of a dynamic MCP server (production version).",
        inputSchema: {
          type: "object" as const,
          properties: { name: { type: "string", description: "MCP server name" } },
          required: ["name"],
        },
      },
      {
        name: "create",
        description: "Create a new dynamic MCP server (v1). The code must be JavaScript and will run in a sandboxed environment.",
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
        description: "Push a new version of a dynamic MCP server. Auto-promotes to production and reloads sandbox by default.",
        inputSchema: {
          type: "object" as const,
          properties: {
            name: { type: "string" },
            code: { type: "string" },
            description: { type: "string" },
            promote: { type: "boolean", description: "Set new version as production + reload (default: true)" },
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
        description: "Delete a dynamic MCP server and all its versions from DB, unregister from runtime.",
        inputSchema: {
          type: "object" as const,
          properties: { name: { type: "string" } },
          required: ["name"],
        },
      },
      {
        name: "reload",
        description: "Reload a dynamic MCP server — re-reads production version code from DB and re-registers in sandbox.",
        inputSchema: {
          type: "object" as const,
          properties: { name: { type: "string" } },
          required: ["name"],
        },
      },
      {
        name: "list_versions",
        description: "List all versions of a dynamic MCP server, showing which is production.",
        inputSchema: {
          type: "object" as const,
          properties: { name: { type: "string" } },
          required: ["name"],
        },
      },
      {
        name: "set_production",
        description: "Set a specific version as production (rollback/promote). Auto-reloads sandbox if enabled.",
        inputSchema: {
          type: "object" as const,
          properties: {
            name: { type: "string" },
            version: { type: "number", description: "Version number to set as production" },
          },
          required: ["name", "version"],
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
        if (loadError) return text(`Created MCP server "${record.name}" (v1) but sandbox load failed: ${loadError}`);
        if (!record.enabled) return text(`Created MCP server "${record.name}" (v1, disabled)`);
        return text(`Created and loaded MCP server "${record.name}" (v1)`);
      }
      case "update_code": {
        const params = svc.McpUpdateParams.parse(args);
        const { record, version, loadError } = await svc.updateMcpServer(params);
        const promoted = params.promote ? " (promoted to production)" : "";
        let msg = `Pushed MCP server "${record.name}" v${version.version}${promoted}`;
        if (loadError) msg += ` — sandbox load failed: ${loadError}`;
        return text(msg);
      }
      case "toggle": {
        const params = svc.McpToggleParams.parse(args);
        const record = await svc.toggleMcpServer(params);
        return text(`MCP server "${record.name}" is now ${record.enabled ? "enabled" : "disabled"}`);
      }
      case "delete": {
        const { name: n } = svc.McpNameParams.parse(args);
        await svc.deleteMcpServer(n);
        return text(`Deleted MCP server "${n}" and all versions`);
      }
      case "reload": {
        const { name: n } = svc.McpNameParams.parse(args);
        const msg = await svc.reloadMcpServer(n);
        return text(msg);
      }
      case "list_versions": {
        const { name: n } = svc.McpNameParams.parse(args);
        const versions = await svc.listMcpServerVersions(n);
        return json(versions);
      }
      case "set_production": {
        const { name: n, version } = svc.McpSetProductionParams.parse(args);
        const { record, loadError } = await svc.setMcpProduction(n, version);
        let msg = `MCP server "${record.name}" production set to v${record.productionVersion}`;
        if (loadError) msg += ` — sandbox load failed: ${loadError}`;
        return text(msg);
      }
      default:
        return text(`Unknown tool: ${name}`);
    }
  },
};
