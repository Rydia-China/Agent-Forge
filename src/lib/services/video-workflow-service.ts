/**
 * Video Workflow Service — data access for the video UI.
 *
 * Uses domain_resources (generic) + novel_scripts (episode container).
 * No business concepts (characters, costumes, scenes, shots) in code.
 */

import { bizPool } from "@/lib/biz-db";
import { resolveTable, GLOBAL_USER } from "@/lib/biz-db-namespace";
import { ensureVideoSchema } from "@/lib/video/schema";
import { prisma } from "@/lib/db";
import {
  getResourcesByScope,
  deleteResourcesByScope,
  deleteResource,
  updateResourceData,
} from "@/lib/domain/resource-service";
import type {
  DomainResource,
  CategoryGroup,
  DomainResources,
} from "@/lib/domain/resource-service";
import "@/lib/domain/resource-cleanup"; // register biz-table cleanup hook
import { initMcp } from "@/lib/mcp/init";
import { loadFromCatalog, isCatalogEntry } from "@/lib/mcp/catalog";
import { registry } from "@/lib/mcp/registry";
import { sandboxManager } from "@/lib/mcp/sandbox";
import * as mcpService from "@/lib/services/mcp-service";

export type { DomainResource, CategoryGroup, DomainResources };

/* ------------------------------------------------------------------ */
/*  Helper: resolve physical table name                                */
/* ------------------------------------------------------------------ */

async function physical(logicalName: string): Promise<string> {
  await ensureVideoSchema();
  const resolved = await resolveTable(GLOBAL_USER, logicalName);
  if (!resolved) throw new Error(`Video table "${logicalName}" not found in BizTableMapping`);
  return resolved.physicalName;
}

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type EpStatus = "empty" | "uploaded" | "has_resources";

export interface EpisodeSummary {
  id: string;
  novelId: string;
  scriptKey: string;
  scriptName: string | null;
  status: EpStatus;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/*  Episodes                                                           */
/* ------------------------------------------------------------------ */

export async function listEpisodes(novelId: string): Promise<EpisodeSummary[]> {
  const tScripts = await physical("novel_scripts");

  const { rows: scripts } = await bizPool.query(
    `SELECT id, novel_id, script_key, script_name,
            script_content IS NOT NULL AS has_content,
            created_at
     FROM "${tScripts}"
     WHERE novel_id = $1
     ORDER BY script_key`,
    [novelId],
  );

  const episodes: EpisodeSummary[] = [];
  for (const row of scripts as Array<Record<string, unknown>>) {
    const scriptId = row.id as string;
    const hasContent = row.has_content as boolean;

    // Check if any domain_resources exist for this script
    let hasResources = false;
    if (hasContent) {
      const groups = await getResourcesByScope("script", scriptId);
      hasResources = groups.length > 0;
    }

    episodes.push({
      id: scriptId,
      novelId: row.novel_id as string,
      scriptKey: row.script_key as string,
      scriptName: row.script_name as string | null,
      status: !hasContent ? "empty" : hasResources ? "has_resources" : "uploaded",
      createdAt: String(row.created_at),
    });
  }

  return episodes;
}

export async function createEpisode(
  novelId: string,
  scriptKey: string,
  scriptName: string | null,
  scriptContent: string | null,
): Promise<{ id: string }> {
  const tScripts = await physical("novel_scripts");

  const { rows } = await bizPool.query(
    `INSERT INTO "${tScripts}" (novel_id, script_key, script_name, script_content)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [novelId, scriptKey, scriptName, scriptContent],
  );

  const row = rows[0] as { id: string } | undefined;
  if (!row) throw new Error("Failed to create episode");
  return row;
}

export async function deleteEpisode(scriptId: string): Promise<void> {
  const tScripts = await physical("novel_scripts");

  // Look up novel_id + script_key to derive session userName
  const { rows: scriptRows } = await bizPool.query(
    `SELECT novel_id, script_key FROM "${tScripts}" WHERE id = $1 LIMIT 1`,
    [scriptId],
  );
  const scriptRow = scriptRows[0] as { novel_id: string; script_key: string } | undefined;

  // Delete domain_resources for this script
  await deleteResourcesByScope("script", scriptId);

  // Delete the script itself
  await bizPool.query(`DELETE FROM "${tScripts}" WHERE id = $1`, [scriptId]);

  // Cascade-delete associated sessions (messages, tasks, events, key resources)
  if (scriptRow) {
    const userName = `video:${scriptRow.novel_id}:${scriptRow.script_key}`;
    const user = await prisma.user.findUnique({ where: { name: userName } });
    if (user) {
      await prisma.chatSession.deleteMany({ where: { userId: user.id } });
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Resources                                                          */
/* ------------------------------------------------------------------ */

export async function getResources(
  scriptId: string,
  novelId: string,
): Promise<DomainResources> {
  // Get domain_resources for both scopes, then merge by category
  const [novelGroups, scriptGroups] = await Promise.all([
    getResourcesByScope("novel", novelId),
    getResourcesByScope("script", scriptId),
  ]);

  const merged = new Map<string, DomainResource[]>();
  for (const g of [...novelGroups, ...scriptGroups]) {
    const existing = merged.get(g.category);
    if (existing) {
      existing.push(...g.items);
    } else {
      merged.set(g.category, [...g.items]);
    }
  }

  return {
    categories: [...merged.entries()].map(([category, items]) => ({ category, items })),
  };
}

/* ------------------------------------------------------------------ */
/*  Resource mutations                                                 */
/* ------------------------------------------------------------------ */

/**
 * Update a domain resource's data field (for JSON editor).
 */
export { updateResourceData, deleteResource };

export async function getEpisodeContent(scriptId: string): Promise<string | null> {
  const tScripts = await physical("novel_scripts");
  const { rows } = await bizPool.query(
    `SELECT script_content FROM "${tScripts}" WHERE id = $1 LIMIT 1`,
    [scriptId],
  );
  const row = rows[0] as { script_content: string | null } | undefined;
  return row?.script_content ?? null;
}

/* ------------------------------------------------------------------ */
/*  init_workflow integration                                          */
/* ------------------------------------------------------------------ */

export interface InitWorkflowResult {
  scriptId: string;
  scriptKey: string;
  scriptName: string;
  missingCharacters: string[];
  characters: string[];
  costumes: Record<string, string>;
  nextStep: string;
}

/**
 * Load a dynamic MCP by name (from DB → QuickJS sandbox).
 * No-op if already loaded.
 */
async function ensureDynamicMcp(name: string): Promise<void> {
  if (registry.getProvider(name)) return;
  if (isCatalogEntry(name)) {
    loadFromCatalog(name);
    return;
  }
  const code = await mcpService.getMcpCode(name);
  if (!code) throw new Error(`MCP "${name}" not found in DB`);
  const provider = await sandboxManager.load(name, code);
  registry.replace(provider);
}

/**
 * Run the novel-video-workflow MCP's init_workflow tool.
 *
 * Loads MCP infrastructure on demand, executes the tool, and stores
 * the result in novel_scripts.init_result.
 *
 * Throws on failure — init is a prerequisite for all downstream steps.
 */
export async function runInitWorkflow(
  novelId: string,
  scriptDbId: string,
  scriptContent: string,
): Promise<InitWorkflowResult> {
  await initMcp();
  await ensureDynamicMcp("biz_db");
  await ensureDynamicMcp("subagent");
  await ensureDynamicMcp("langfuse");
  await ensureDynamicMcp("novel-video-workflow");

  const result = await registry.callTool(
    "novel-video-workflow__init_workflow",
    { novelId, scriptContent, scriptDbId },
  );

  const text = result.content
    ?.map((c: Record<string, unknown>) =>
      "text" in c ? String(c.text) : JSON.stringify(c),
    )
    .join("\n") ?? "";

  const parsed = JSON.parse(text) as InitWorkflowResult;

  // Persist init_result + characters/costumes via parameterized query
  // (MCP tool may also write these, but this is the reliable fallback)
  const tScripts = await physical("novel_scripts");
  await bizPool.query(
    `UPDATE "${tScripts}"
     SET init_result = $1,
         characters = $2::jsonb,
         costumes   = $3::jsonb
     WHERE id = $4`,
    [
      JSON.stringify(parsed),
      JSON.stringify(parsed.characters ?? []),
      JSON.stringify(parsed.costumes ?? {}),
      scriptDbId,
    ],
  );

  return parsed;
}

/**
 * Read the stored init_result for an episode.
 */
export async function getInitResult(
  novelId: string,
  scriptKey: string,
): Promise<InitWorkflowResult | null> {
  const tScripts = await physical("novel_scripts");
  const { rows } = await bizPool.query(
    `SELECT init_result FROM "${tScripts}"
     WHERE novel_id = $1 AND script_key = $2
     LIMIT 1`,
    [novelId, scriptKey],
  );
  const row = rows[0] as { init_result: unknown } | undefined;
  if (!row?.init_result) return null;
  return (typeof row.init_result === "string"
    ? JSON.parse(row.init_result)
    : row.init_result) as InitWorkflowResult;
}

export async function getEpisodeStatus(scriptId: string): Promise<EpStatus> {
  const tScripts = await physical("novel_scripts");

  const { rows: scriptRows } = await bizPool.query(
    `SELECT script_content IS NOT NULL AS has_content
     FROM "${tScripts}"
     WHERE id = $1`,
    [scriptId],
  );

  const script = scriptRows[0] as { has_content: boolean } | undefined;
  if (!script || !script.has_content) return "empty";

  const groups = await getResourcesByScope("script", scriptId);
  return groups.length > 0 ? "has_resources" : "uploaded";
}
