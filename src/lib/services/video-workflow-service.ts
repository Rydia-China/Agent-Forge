/**
 * Video Workflow Service — data access for the video UI.
 *
 * Uses novels (local registry) + novel_scripts (episodes) + domain_resources.
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
import type { ScriptEpisode } from "@/lib/video/script-upload-schema";

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

export interface NovelSummary {
  id: string;
  name: string;
  episodeCount: number;
  createdAt: string;
}

export interface EpisodeSummary {
  id: string;
  novelId: string;
  scriptKey: string;
  scriptName: string | null;
  status: EpStatus;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/*  Novels (local CRUD)                                                */
/* ------------------------------------------------------------------ */

export async function listNovels(): Promise<NovelSummary[]> {
  const tNovels = await physical("novels");
  const { rows } = await bizPool.query(
    `SELECT id, name, episode_count, created_at
     FROM "${tNovels}"
     ORDER BY created_at DESC`,
  );
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    episodeCount: r.episode_count as number,
    createdAt: String(r.created_at),
  }));
}

export async function deleteNovel(novelId: string): Promise<void> {
  const tNovels = await physical("novels");
  const tScripts = await physical("novel_scripts");

  // Cascade-delete all episodes
  const { rows: epRows } = await bizPool.query(
    `SELECT id FROM "${tScripts}" WHERE novel_id = $1`,
    [novelId],
  );
  for (const row of epRows as Array<{ id: string }>) {
    await deleteEpisode(row.id);
  }

  // Delete novel-scoped domain_resources
  await deleteResourcesByScope("novel", novelId);

  // Delete novel record
  await bizPool.query(`DELETE FROM "${tNovels}" WHERE id = $1`, [novelId]);
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
/*  Batch upload (per-Job)                                             */
/* ------------------------------------------------------------------ */

/**
 * Create a new novel and insert all episodes from a validated JSON upload.
 * Returns the novel ID and created episodes.
 */
export async function createNovelWithScript(
  name: string,
  episodes: ScriptEpisode[],
): Promise<{ novelId: string; episodes: EpisodeSummary[] }> {
  const tNovels = await physical("novels");
  const tScripts = await physical("novel_scripts");

  // 1. Create novel
  const { rows: novelRows } = await bizPool.query(
    `INSERT INTO "${tNovels}" (name, episode_count) VALUES ($1, $2) RETURNING id`,
    [name, episodes.length],
  );
  const novelRow = novelRows[0] as { id: string } | undefined;
  if (!novelRow) throw new Error("Failed to create novel");
  const novelId = novelRow.id;

  // 2. Batch insert episodes
  const created = await insertEpisodes(tScripts, novelId, episodes);
  return { novelId, episodes: created };
}

/**
 * Replace all episodes for an existing novel with data from a validated JSON upload.
 */
export async function replaceNovelScript(
  novelId: string,
  episodes: ScriptEpisode[],
): Promise<EpisodeSummary[]> {
  const tNovels = await physical("novels");
  const tScripts = await physical("novel_scripts");

  // 1. Delete existing episodes
  const { rows: existingRows } = await bizPool.query(
    `SELECT id FROM "${tScripts}" WHERE novel_id = $1`,
    [novelId],
  );
  for (const row of existingRows as Array<{ id: string }>) {
    await deleteEpisode(row.id);
  }

  // 2. Batch insert new episodes
  const created = await insertEpisodes(tScripts, novelId, episodes);

  // 3. Update episode count
  await bizPool.query(
    `UPDATE "${tNovels}" SET episode_count = $1 WHERE id = $2`,
    [created.length, novelId],
  );

  return created;
}

/** Internal: insert episodes into novel_scripts. */
async function insertEpisodes(
  tScripts: string,
  novelId: string,
  episodes: ScriptEpisode[],
): Promise<EpisodeSummary[]> {
  const created: EpisodeSummary[] = [];
  for (const ep of episodes) {
    const scriptKey =
      ep.variant_kind === "mainline"
        ? `EP${ep.ep_num}`
        : `EP${ep.ep_num}-${ep.variant_kind}`;

    const { rows } = await bizPool.query(
      `INSERT INTO "${tScripts}"
        (novel_id, script_key, script_name, script_content,
         init_result, characters, costumes)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
       RETURNING id, created_at`,
      [
        novelId,
        scriptKey,
        ep.output.episode_title,
        ep.output.pre_choice_script,
        JSON.stringify(ep.output),
        JSON.stringify(ep.output.characters),
        JSON.stringify(ep.output.character_outfits),
      ],
    );

    const row = rows[0] as { id: string; created_at: string } | undefined;
    if (!row) throw new Error(`Failed to insert episode ${scriptKey}`);

    created.push({
      id: row.id,
      novelId,
      scriptKey,
      scriptName: ep.output.episode_title,
      status: "uploaded",
      createdAt: String(row.created_at),
    });
  }
  return created;
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

/**
 * Read the stored init_result (full episode output JSON) for an episode.
 */
export async function getEpisodeOutput(
  scriptId: string,
): Promise<Record<string, unknown> | null> {
  const tScripts = await physical("novel_scripts");
  const { rows } = await bizPool.query(
    `SELECT init_result FROM "${tScripts}" WHERE id = $1 LIMIT 1`,
    [scriptId],
  );
  const row = rows[0] as { init_result: unknown } | undefined;
  if (!row?.init_result) return null;
  return (typeof row.init_result === "string"
    ? JSON.parse(row.init_result)
    : row.init_result) as Record<string, unknown>;
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
