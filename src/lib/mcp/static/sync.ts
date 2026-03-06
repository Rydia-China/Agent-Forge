import type { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types";
import type { McpProvider } from "../types";
import * as svc from "@/lib/services/sync-service";

function text(t: string): CallToolResult {
  return { content: [{ type: "text", text: t }] };
}

function json(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

export const syncMcp: McpProvider = {
  name: "sync",

  async listTools(): Promise<Tool[]> {
    return [
      {
        name: "discover",
        description:
          "List skills or MCPs available on a remote hub. Defaults to the configured hub. " +
          "Returns metadata only (name, description, tags). Use this to find what's available before pulling.",
        inputSchema: {
          type: "object" as const,
          properties: {
            type: { type: "string", enum: ["skill", "mcp"], description: "Resource type to discover" },
            tag: { type: "string", description: "Optional: filter skills by tag" },
            source_url: { type: "string", description: "Optional: remote URL (defaults to hub)" },
          },
          required: ["type"],
        },
      },
      {
        name: "diff",
        description:
          "Compare local vs remote skills or MCPs. Shows which exist locally only, remotely only, or both. " +
          "Use this before bulk_pull or bulk_push to understand the sync state.",
        inputSchema: {
          type: "object" as const,
          properties: {
            type: { type: "string", enum: ["skill", "mcp"], description: "Resource type to diff" },
            names: { type: "array", items: { type: "string" }, description: "Optional: specific names to compare" },
            tag: { type: "string", description: "Optional: filter skills by tag" },
            source_url: { type: "string", description: "Optional: remote URL (defaults to hub)" },
          },
          required: ["type"],
        },
      },
      {
        name: "pull",
        description:
          "Pull a single skill or MCP from a remote hub to local. " +
          "Creates a new local version (safe to revert). If it doesn't exist locally, creates it.",
        inputSchema: {
          type: "object" as const,
          properties: {
            type: { type: "string", enum: ["skill", "mcp"], description: "Resource type" },
            name: { type: "string", description: "Name of the skill or MCP to pull" },
            source_url: { type: "string", description: "Optional: remote URL (defaults to hub)" },
          },
          required: ["type", "name"],
        },
      },
      {
        name: "push",
        description:
          "Push a single local skill or MCP to a remote hub. " +
          "Creates it remotely if new, or pushes a new version if it already exists.",
        inputSchema: {
          type: "object" as const,
          properties: {
            type: { type: "string", enum: ["skill", "mcp"], description: "Resource type" },
            name: { type: "string", description: "Name of the skill or MCP to push" },
            target_url: { type: "string", description: "Optional: remote URL (defaults to hub)" },
          },
          required: ["type", "name"],
        },
      },
    ];
  },

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<CallToolResult> {
    switch (name) {
      case "discover": {
        const params = svc.SyncDiscoverParams.parse({
          type: args.type,
          tag: args.tag,
          sourceUrl: args.source_url,
        });
        const result = await svc.discoverRemote(params);
        return json(result);
      }
      case "diff": {
        const params = svc.SyncDiffParams.parse({
          type: args.type,
          names: args.names,
          tag: args.tag,
          sourceUrl: args.source_url,
        });
        const result = await svc.diffWithRemote(params);
        return json(result);
      }
      case "pull": {
        const params = svc.SyncPullParams.parse({
          type: args.type,
          name: args.name,
          sourceUrl: args.source_url,
        });
        const result = await svc.pullFromRemote(params);
        return text(
          `Pulled ${result.type} "${result.name}" from ${result.sourceUrl} → local v${result.localVersion} (${result.action})`,
        );
      }
      case "push": {
        const params = svc.SyncPushParams.parse({
          type: args.type,
          name: args.name,
          targetUrl: args.target_url,
        });
        const result = await svc.pushToRemote(params);
        return text(
          `Pushed ${result.type} "${result.name}" to ${result.targetUrl} (${result.action})`,
        );
      }
      default:
        return text(`Unknown tool: ${name}`);
    }
  },
};
