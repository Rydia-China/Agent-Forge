import type { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types";
import type { McpProvider } from "../types";
import { registry } from "../registry";
import { getCatalogEntries, isCatalogEntry, loadFromCatalog } from "../catalog";
import { sandboxManager } from "../sandbox";
import { sessionMcpTracker } from "../session-tracker";
import { getCurrentSessionId } from "@/lib/request-context";
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
        description: "List active (loaded) MCPs and available (unloaded) MCPs. Use to see what is currently loaded and what can be loaded.",
        inputSchema: { type: "object" as const, properties: {} },
      },
      {
        name: "list_available",
        description: "List MCP servers that can be loaded but are not currently active. Includes catalog (built-in) and DB dynamic servers.",
        inputSchema: { type: "object" as const, properties: {} },
      },
      {
        name: "load",
        description: "Load an MCP server into the active runtime so its tools become available. Works for both catalog (built-in) and DB dynamic servers. Call this when a skill's requires_mcps lists MCPs that are not yet active.",
        inputSchema: {
          type: "object" as const,
          properties: { name: { type: "string", description: "MCP server name to load" } },
          required: ["name"],
        },
      },
      {
        name: "unload",
        description: "Unload an MCP server from the active runtime. Cannot unload system built-in MCPs. Use after finishing a task to reduce active tool count.",
        inputSchema: {
          type: "object" as const,
          properties: { name: { type: "string", description: "MCP server name to unload" } },
          required: ["name"],
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
        const sessionId = getCurrentSessionId();
        const visible = sessionId
          ? sessionMcpTracker.getVisible(sessionId)
          : new Set(registry.listProviders().map((p) => p.name));
        const active = [...visible];
        const catalog = getCatalogEntries().map((e) => ({
          name: e.name,
          available: e.available,
          active: visible.has(e.name),
        }));
        const database = (await svc.listMcpServers()).map((m) => ({
          name: m.name,
          enabled: m.enabled,
          active: visible.has(m.name),
        }));
        return json({ active, catalog, database });
      }
      case "list_available": {
        const sessionId = getCurrentSessionId();
        const visible = sessionId
          ? sessionMcpTracker.getVisible(sessionId)
          : new Set(registry.listProviders().map((p) => p.name));
        const catalogAvailable = getCatalogEntries()
          .filter((e) => e.available && !visible.has(e.name))
          .map((e) => ({ name: e.name, source: "catalog" as const }));
        const dbAvailable = (await svc.listMcpServers())
          .filter((m) => m.enabled && !visible.has(m.name))
          .map((m) => ({ name: m.name, source: "database" as const }));
        return json([...catalogAvailable, ...dbAvailable]);
      }
      case "load": {
        const { name: n } = svc.McpNameParams.parse(args);
        const sessionId = getCurrentSessionId();
        // Try catalog first
        if (isCatalogEntry(n)) {
          loadFromCatalog(n); // ensure provider is in global pool
          if (sessionId) sessionMcpTracker.load(sessionId, n);
          return text(`Loaded catalog MCP "${n}" — its tools are now available`);
        }
        // Try DB dynamic
        const server = await svc.getMcpServer(n);
        if (!server) return text(`MCP "${n}" not found in catalog or database`);
        const code = await svc.getMcpCode(n);
        if (!code) return text(`MCP "${n}" has no production code`);
        try {
          const provider = await sandboxManager.load(n, code);
          registry.replace(provider);
          if (sessionId) sessionMcpTracker.load(sessionId, n);
          return text(`Loaded dynamic MCP "${n}" — its tools are now available`);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          return text(`Failed to load MCP "${n}": ${msg}`);
        }
      }
      case "unload": {
        const { name: n } = svc.McpNameParams.parse(args);
        if (registry.isProtected(n)) return text(`Cannot unload system built-in MCP "${n}"`);
        const sessionId = getCurrentSessionId();
        // Session-scoped: remove from this session's visibility only
        if (sessionId) {
          sessionMcpTracker.unload(sessionId, n);
          return text(`Unloaded MCP "${n}" from this session`);
        }
        // Fallback (no session context, e.g. external MCP call): global unload
        if (!registry.getProvider(n)) return text(`MCP "${n}" is not currently loaded`);
        registry.unregister(n);
        sandboxManager.unload(n);
        return text(`Unloaded MCP "${n}"`);
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
