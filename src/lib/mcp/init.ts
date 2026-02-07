import { registry } from "./registry.js";
import { sandboxManager } from "./sandbox.js";
import { skillsMcp } from "./static/skills-mcp.js";
import { mcpManagerMcp } from "./static/mcp-manager.js";
import { prisma } from "@/lib/db";

let initialized = false;

/**
 * Register static MCP providers + load all enabled dynamic MCPs from DB.
 * Safe to call multiple times — only runs once.
 */
export async function initMcp(): Promise<void> {
  if (initialized) return;
  initialized = true;

  // Static providers
  registry.register(skillsMcp);
  registry.register(mcpManagerMcp);

  // Dynamic providers from DB
  const records = await prisma.mcpServer.findMany({ where: { enabled: true } });
  for (const record of records) {
    try {
      const provider = await sandboxManager.load(record.name, record.code);
      registry.replace(provider);
    } catch (err) {
      console.error(`[initMcp] Failed to load dynamic MCP "${record.name}":`, err);
    }
  }
}
