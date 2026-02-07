import type { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpProvider } from "../types.js";
import { registry } from "../registry.js";
import { prisma } from "@/lib/db";

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
        description:
          "List all registered MCP servers (both static in-memory and dynamic from DB).",
        inputSchema: { type: "object" as const, properties: {} },
      },
      {
        name: "get_code",
        description: "Get the JavaScript source code of a dynamic MCP server.",
        inputSchema: {
          type: "object" as const,
          properties: {
            name: { type: "string", description: "MCP server name" },
          },
          required: ["name"],
        },
      },
      {
        name: "create",
        description:
          "Create a new dynamic MCP server. The code must be JavaScript and will run in a sandboxed environment.",
        inputSchema: {
          type: "object" as const,
          properties: {
            name: { type: "string" },
            description: { type: "string" },
            code: {
              type: "string",
              description:
                "JavaScript source implementing listTools() and callTool(name, args)",
            },
            enabled: { type: "boolean", description: "Default: true" },
          },
          required: ["name", "code"],
        },
      },
      {
        name: "update_code",
        description:
          "Update the code (and optionally description) of an existing dynamic MCP server.",
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
          properties: {
            name: { type: "string" },
            enabled: { type: "boolean" },
          },
          required: ["name", "enabled"],
        },
      },
      {
        name: "delete",
        description:
          "Delete a dynamic MCP server from DB and unregister it from the runtime registry.",
        inputSchema: {
          type: "object" as const,
          properties: {
            name: { type: "string" },
          },
          required: ["name"],
        },
      },
      {
        name: "reload",
        description:
          "Reload a dynamic MCP server — re-reads code from DB and re-registers in sandbox. Useful after code changes.",
        inputSchema: {
          type: "object" as const,
          properties: {
            name: { type: "string" },
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
      case "list": {
        // Runtime providers
        const runtime = registry.listProviders().map((p) => ({
          name: p.name,
          source: "runtime",
        }));
        // DB records
        const dbRecords = await prisma.mcpServer.findMany({
          select: {
            name: true,
            description: true,
            enabled: true,
            updatedAt: true,
          },
          orderBy: { name: "asc" },
        });
        return json({ runtime, database: dbRecords });
      }

      case "get_code": {
        const record = await prisma.mcpServer.findUnique({
          where: { name: args.name as string },
        });
        if (!record) return text(`MCP server "${args.name}" not found in DB`);
        return text(record.code);
      }

      case "create": {
        const record = await prisma.mcpServer.create({
          data: {
            name: args.name as string,
            description: (args.description as string) ?? null,
            code: args.code as string,
            enabled: (args.enabled as boolean) ?? true,
          },
        });
        // Phase 3 will auto-load into sandbox here
        return text(
          `Created MCP server "${record.name}". Use reload to load it into the runtime.`,
        );
      }

      case "update_code": {
        const data: Record<string, unknown> = { code: args.code };
        if (args.description !== undefined) data.description = args.description;
        const record = await prisma.mcpServer.update({
          where: { name: args.name as string },
          data,
        });
        return text(
          `Updated MCP server "${record.name}". Use reload to apply changes.`,
        );
      }

      case "toggle": {
        const record = await prisma.mcpServer.update({
          where: { name: args.name as string },
          data: { enabled: args.enabled as boolean },
        });
        const state = record.enabled ? "enabled" : "disabled";
        if (!record.enabled) {
          registry.unregister(record.name);
        }
        return text(`MCP server "${record.name}" is now ${state}`);
      }

      case "delete": {
        const n = args.name as string;
        registry.unregister(n);
        await prisma.mcpServer.delete({ where: { name: n } });
        return text(`Deleted MCP server "${n}"`);
      }

      case "reload": {
        const record = await prisma.mcpServer.findUnique({
          where: { name: args.name as string },
        });
        if (!record)
          return text(`MCP server "${args.name}" not found in DB`);
        if (!record.enabled)
          return text(
            `MCP server "${record.name}" is disabled. Enable it first.`,
          );
        // TODO: Phase 3 — load code into isolated-vm sandbox and register provider
        // For now, just acknowledge
        return text(
          `Reload requested for "${record.name}". Sandbox loading will be available after Phase 3.`,
        );
      }

      default:
        return text(`Unknown tool: ${name}`);
    }
  },
};
