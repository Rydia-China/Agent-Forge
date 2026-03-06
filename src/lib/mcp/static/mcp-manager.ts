import type { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types";
import { type McpProvider, type ToolContext, qualifyToolName } from "../types";
import { registry } from "../registry";
import { isCatalogEntry, loadFromCatalog } from "../catalog";
import { sandboxManager } from "../sandbox";
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
        description: "List all active MCP servers (core, catalog, and dynamic).",
        inputSchema: { type: "object" as const, properties: {} },
      },
      {
        name: "use",
        description: "Call a tool from an MCP that is not in your current tool list. Auto-loads the MCP on first use; subsequent calls within this session can use the tool directly. Use this for any tool whose prefix is not in your active tool list.",
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
        name: "patch_code",
        description: "Apply search-and-replace patches to a dynamic MCP server's production code. Creates a new version. Much cheaper than update_code for small changes — prefer this over update_code when modifying existing code.",
        inputSchema: {
          type: "object" as const,
          properties: {
            name: { type: "string" },
            patches: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  search: { type: "string", description: "Exact text to find in current code" },
                  replace: { type: "string", description: "Replacement text" },
                },
                required: ["search", "replace"],
              },
              description: "Array of search-and-replace patches applied sequentially",
            },
            description: { type: "string" },
            promote: { type: "boolean", description: "Set new version as production + reload (default: true)" },
          },
          required: ["name", "patches"],
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
    context?: ToolContext,
  ): Promise<CallToolResult> {
    switch (name) {
      case "use": {
        const provider = args.provider as string | undefined;
        const tool = args.tool as string | undefined;
        const toolArgs = (args.args ?? {}) as Record<string, unknown>;
        if (!provider || !tool) return text("Missing required parameters: provider, tool");

        // Auto-load the MCP if not already registered
        if (!registry.getProvider(provider)) {
          try {
            if (isCatalogEntry(provider)) {
              loadFromCatalog(provider);
            } else {
              const code = await svc.getMcpCode(provider);
              if (!code) return text(`MCP "${provider}" not found in catalog or database`);
              const p = await sandboxManager.load(provider, code);
              registry.replace(p);
            }
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            return { content: [{ type: "text", text: `Failed to load MCP "${provider}": ${msg}` }], isError: true };
          }
        }

        // Dispatch the actual tool call
        return registry.callTool(qualifyToolName(provider, tool), toolArgs, context);
      }
      case "list": {
        const active = registry.listProviders().map((p) => p.name);
        const database = (await svc.listMcpServers()).map((m) => ({
          name: m.name,
          enabled: m.enabled,
          active: !!registry.getProvider(m.name),
        }));
        return json({ active, database });
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
      case "patch_code": {
        const params = svc.McpPatchParams.parse(args);
        const { record, version, loadError } = await svc.patchMcpServer(params);
        const promoted = params.promote ? " (promoted to production)" : "";
        let msg = `Patched MCP server "${record.name}" → v${version.version}${promoted} (${params.patches.length} patch(es))`;
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
