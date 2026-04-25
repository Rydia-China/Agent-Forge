import { registry } from "./registry";
import { skillsMcp } from "./static/skills-mcp";
import { mcpManagerMcp } from "./static/mcp-manager";
import { uiMcp } from "./static/ui";
import { syncMcp } from "./static/sync";
import { bizDbReady } from "@/lib/biz-db";

/**
 * Register core MCP providers.
 * Core: skills + mcp_manager + ui + sync — always active, protected.
 * All other MCPs (catalog + dynamic) are loaded on-demand by:
 *   - Skill declarations (requiresMcps) at agent loop start
 *   - mcp_manager__use dispatcher during agent loop
 *
 * Safe to call multiple times — only runs once (guarded by registry.initialized).
 */
export async function initMcp(): Promise<void> {
  if (registry.initialized) return;
  registry.initialized = true;

  // Trigger database initialization in background (non-blocking)
  // biz_db tools will await bizDbReady when actually called
  bizDbReady.catch((err) => {
    console.error("[initMcp] Background database initialization failed:", err);
  });

  // Core providers — always active, protected from custom override
  registry.register(skillsMcp);
  registry.register(mcpManagerMcp);
  registry.register(uiMcp);
  registry.register(syncMcp);

  registry.protect(skillsMcp.name);
  registry.protect(mcpManagerMcp.name);
  registry.protect(uiMcp.name);
  registry.protect(syncMcp.name);
}
