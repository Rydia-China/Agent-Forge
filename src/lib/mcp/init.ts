import { registry } from "./registry";
import { skillsMcp } from "./static/skills-mcp";
import { mcpManagerMcp } from "./static/mcp-manager";
import { uiMcp } from "./static/ui";
import { memoryMcp } from "./static/memory";
import { syncMcp } from "./static/sync";
import { executorMcp } from "./static/executor";
import { isCatalogEntry, loadFromCatalog } from "./catalog";
import { sandboxManager } from "./sandbox";
import { getMcpCode } from "@/lib/services/mcp-service";
import { bizDbReady } from "@/lib/biz-db";
import { restoreSchedules } from "@/lib/services/scheduler-service";

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
  registry.register(syncMcp);
  registry.register(executorMcp);

  registry.protect(skillsMcp.name);
  registry.protect(mcpManagerMcp.name);
  registry.protect(uiMcp.name);
  registry.protect(memoryMcp.name);
  registry.protect(syncMcp.name);
  registry.protect(executorMcp.name);

  // Auto-load: when registry.callTool encounters an unknown provider,
  // try loading it from catalog or DB before returning an error.
  registry.setAutoLoad(async (name) => {
    if (isCatalogEntry(name)) {
      loadFromCatalog(name);
      return registry.getProvider(name) ?? null;
    }
    const code = await getMcpCode(name);
    if (!code) return null;
    const provider = await sandboxManager.load(name, code);
    registry.replace(provider);
    return provider;
  });

  // Restore scheduled tasks from DB (fire-and-forget, non-blocking)
  void restoreSchedules().catch((err) =>
    console.error("[scheduler] Failed to restore schedules:", err),
  );
}
