import { registry } from "./registry";
import { skillsMcp } from "./static/skills-mcp";
import { mcpManagerMcp } from "./static/mcp-manager";
import { uiMcp } from "./static/ui";
import { memoryMcp } from "./static/memory";
import { bizDbReady } from "@/lib/biz-db";

/**
 * Register core MCP providers.
 * Core: skills + mcp_manager + ui + memory — always active, protected.
 * All other MCPs (catalog + dynamic) are loaded on-demand by:
 *   - Skill declarations (requiresMcps) at agent loop start
 *   - mcp_manager__use dispatcher during agent loop
 *
 * Safe to call multiple times — only runs once (guarded by registry.initialized).
 */
export async function initMcp(): Promise<void> {
  if (registry.initialized) return;
  registry.initialized = true;

  // Ensure the biz database exists before any tools can use it
  await bizDbReady;

  // Core providers — always active, protected from custom override
  registry.register(skillsMcp);
  registry.register(mcpManagerMcp);
  registry.register(uiMcp);
  registry.register(memoryMcp);

  registry.protect(skillsMcp.name);
  registry.protect(mcpManagerMcp.name);
  registry.protect(uiMcp.name);
  registry.protect(memoryMcp.name);
}
