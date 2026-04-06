import { registry } from "./registry";
import { mcpManagerMcp } from "./static/mcp-manager";
import { uiMcp } from "./static/ui";
import { syncMcp } from "./static/sync";
import { subagentMcp } from "./static/subagent";
import { isCatalogEntry, loadFromCatalog } from "./catalog";
import { sandboxManager } from "./sandbox";
import { getMcpCode } from "@/lib/services/mcp-service";
import { bizDbReady } from "@/lib/biz-db";
import { restoreSchedules } from "@/lib/services/scheduler-service";
import { recoverStaleTasks, startWatchdog } from "@/lib/services/task-service";

/**
 * Register core MCP providers.
 * Core: mcp_manager + ui + sync + subagent — always active, protected.
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
  // Note: skills is no longer a core provider; skill reading is a protocol
  // that each business MCP opts into. skill_admin is a catalog entry.
  registry.register(mcpManagerMcp);
  registry.register(uiMcp);
  registry.register(syncMcp);
  registry.register(subagentMcp);

  registry.protect(mcpManagerMcp.name);
  registry.protect(uiMcp.name);
  registry.protect(syncMcp.name);
  registry.protect(subagentMcp.name);

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

  // Recover stale tasks from previous process (mark as failed)
  void recoverStaleTasks().catch((err) =>
    console.error("[task-recovery] Failed to recover stale tasks:", err),
  );

  // Start periodic watchdog for stuck tasks
  startWatchdog();
}
