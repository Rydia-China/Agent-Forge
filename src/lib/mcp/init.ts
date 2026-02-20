import { registry } from "./registry";
import { skillsMcp } from "./static/skills-mcp";
import { mcpManagerMcp } from "./static/mcp-manager";
import { uiMcp } from "./static/ui";
import { memoryMcp } from "./static/memory";

/**
 * Register core MCP providers only: skills + mcp_manager + ui.
 * All business MCPs live in the catalog and are loaded on-demand
 * by the agent via mcp_manager__load.
 * Safe to call multiple times — only runs once (guarded by registry.initialized).
 */
export async function initMcp(): Promise<void> {
  if (registry.initialized) return;
  registry.initialized = true;

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
