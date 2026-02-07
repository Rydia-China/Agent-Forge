import { registry } from "./registry.js";
import { skillsMcp } from "./static/skills-mcp.js";
import { mcpManagerMcp } from "./static/mcp-manager.js";

let initialized = false;

/**
 * Register all static MCP providers.
 * Safe to call multiple times — only runs once.
 */
export function initMcp(): void {
  if (initialized) return;
  registry.register(skillsMcp);
  registry.register(mcpManagerMcp);
  initialized = true;
}
