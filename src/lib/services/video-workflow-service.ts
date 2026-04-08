/**
 * Video Workflow Service — data access for the video UI.
 *
 * Uses novels (local registry) + novel_scripts (episodes) + KeyResource (single source).
 */

import { bizPool } from "@/lib/biz-db";
import { resolveTable, GLOBAL_USER } from "@/lib/biz-db-namespace";
import { ensureVideoSchema } from "@/lib/video/schema";
import { prisma } from "@/lib/db";
import type { ScriptEpisode, NovelScriptUpload } from "@/lib/video/script-upload-schema";

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

export interface ResourceDiffItem {
  key: string;
  category: string;
  title: string;
  scopeType: string;
  scopeId: string;
  /** generated = currentVersion > 0 (already has content); pending = needs generation */
  status: "generated" | "pending";
  /** true if this KeyResource didn't exist before this upload */
  isNew: boolean;
}

export interface StaleResourceItem {
  key: string;
  category: string;
  title: string;
  scopeType: string;
  scopeId: string;
}

export interface ResourceDiff {
  /** Complete target structure — every resource that SHOULD exist, with progress */
  expected: ResourceDiffItem[];
  /** Resources in DB that are no longer part of the expected structure */
  stale: StaleResourceItem[];
}

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

  // Delete novel-scoped KeyResources
  await prisma.keyResource.deleteMany({ where: { scopeType: "novel", scopeId: novelId } });

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

    // Check if any generated KeyResources exist for this script
    let hasResources = false;
    if (hasContent) {
      const krCount = await prisma.keyResource.count({
        where: { scopeType: "script", scopeId: scriptId, currentVersion: { gt: 0 } },
      });
      hasResources = krCount > 0;
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

  // Delete script-scoped KeyResources
  await prisma.keyResource.deleteMany({ where: { scopeType: "script", scopeId: scriptId } });

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
 * Novel-level data (character_arcs, location_bible, synopsis) stored on novels row.
 * Also creates empty KeyResource entries for all characters, scenes, and costumes.
 */
export async function createNovelWithScript(
  name: string,
  upload: NovelScriptUpload,
): Promise<{ novelId: string; episodes: EpisodeSummary[]; diff: ResourceDiff }> {
  const tNovels = await physical("novels");
  const tScripts = await physical("novel_scripts");
  const episodes = upload.episodes;

  // 1. Create novel with novel-level data
  const { rows: novelRows } = await bizPool.query(
    `INSERT INTO "${tNovels}" (name, episode_count, synopsis, character_arcs, location_bible)
     VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb) RETURNING id`,
    [
      name,
      episodes.length,
      upload.synopsis ? JSON.stringify(upload.synopsis) : null,
      upload.character_arcs ? JSON.stringify(upload.character_arcs) : null,
      upload.location_bible ? JSON.stringify(upload.location_bible) : null,
    ],
  );
  const novelRow = novelRows[0] as { id: string } | undefined;
  if (!novelRow) throw new Error("Failed to create novel");
  const novelId = novelRow.id;

  // 2. Batch insert episodes
  const created = await insertEpisodes(tScripts, novelId, episodes);

  // 3. Create empty KeyResource entries from novel-level data
  const diff = await createEmptyKeyResourcesWithDiff(novelId, upload, created);

  return { novelId, episodes: created, diff };
}

/**
 * Replace source data for an existing novel from a validated JSON upload.
 * Preserves all produced KeyResources (artifacts) and chat sessions.
 * Episodes are matched by scriptKey — matched rows are updated in-place,
 * new episodes are inserted, removed episodes are deleted (but their
 * KeyResources are intentionally kept).
 */
export async function replaceNovelScript(
  novelId: string,
  upload: NovelScriptUpload,
): Promise<{ episodes: EpisodeSummary[]; diff: ResourceDiff }> {
  const tNovels = await physical("novels");
  const tScripts = await physical("novel_scripts");
  const episodes = upload.episodes;

  // 1. Build scriptKey → episode map for new data
  const newByKey = new Map<string, ScriptEpisode>();
  for (const ep of episodes) {
    const key =
      ep.variant_kind === "mainline"
        ? `EP${ep.ep_num}`
        : `EP${ep.ep_num}-${ep.variant_kind}`;
    newByKey.set(key, ep);
  }

  // 2. Load existing episodes to match by scriptKey
  const { rows: existingRows } = await bizPool.query(
    `SELECT id, script_key, created_at FROM "${tScripts}" WHERE novel_id = $1`,
    [novelId],
  );
  const existingByKey = new Map<string, { id: string; createdAt: string }>();
  for (const row of existingRows as Array<{ id: string; script_key: string; created_at: string }>) {
    existingByKey.set(row.script_key, { id: row.id, createdAt: String(row.created_at) });
  }

  // 3. Delete episodes no longer in new upload (row only — KeyResources preserved)
  for (const [key, { id }] of existingByKey) {
    if (!newByKey.has(key)) {
      await bizPool.query(`DELETE FROM "${tScripts}" WHERE id = $1`, [id]);
    }
  }

  // 4. Update matched / insert new episodes
  const result: EpisodeSummary[] = [];
  for (const ep of episodes) {
    const scriptKey =
      ep.variant_kind === "mainline"
        ? `EP${ep.ep_num}`
        : `EP${ep.ep_num}-${ep.variant_kind}`;

    const existing = existingByKey.get(scriptKey);
    if (existing) {
      // UPDATE source data in-place — id stays the same, KeyResources untouched
      await bizPool.query(
        `UPDATE "${tScripts}"
         SET script_name = $1, script_content = $2,
             init_result = $3::jsonb, characters = $4::jsonb, costumes = $5::jsonb
         WHERE id = $6`,
        [
          ep.output.episode_title,
          ep.output.pre_choice_script,
          JSON.stringify(ep.output),
          JSON.stringify(ep.output.characters),
          JSON.stringify(ep.output.character_outfits ?? {}),
          existing.id,
        ],
      );
      result.push({
        id: existing.id,
        novelId,
        scriptKey,
        scriptName: ep.output.episode_title,
        status: "uploaded",
        createdAt: existing.createdAt,
      });
    } else {
      // INSERT new episode
      const { rows } = await bizPool.query(
        `INSERT INTO "${tScripts}"
          (novel_id, script_key, script_name, script_content,
           init_result, characters, costumes)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb)
         RETURNING id, created_at`,
        [
          novelId,
          scriptKey,
          ep.output.episode_title,
          ep.output.pre_choice_script,
          JSON.stringify(ep.output),
          JSON.stringify(ep.output.characters),
          JSON.stringify(ep.output.character_outfits ?? {}),
        ],
      );
      const row = rows[0] as { id: string; created_at: string } | undefined;
      if (!row) throw new Error(`Failed to insert episode ${scriptKey}`);
      result.push({
        id: row.id,
        novelId,
        scriptKey,
        scriptName: ep.output.episode_title,
        status: "uploaded",
        createdAt: String(row.created_at),
      });
    }
  }

  // 5. Update novel-level data + episode count
  await bizPool.query(
    `UPDATE "${tNovels}"
     SET episode_count = $1, synopsis = $2::jsonb, character_arcs = $3::jsonb, location_bible = $4::jsonb
     WHERE id = $5`,
    [
      result.length,
      upload.synopsis ? JSON.stringify(upload.synopsis) : null,
      upload.character_arcs ? JSON.stringify(upload.character_arcs) : null,
      upload.location_bible ? JSON.stringify(upload.location_bible) : null,
      novelId,
    ],
  );

  // 6. Create empty KeyResource entries for any new characters/scenes/costumes (upsert — safe)
  const diff = await createEmptyKeyResourcesWithDiff(novelId, upload, result);

  return { episodes: result, diff };
}

/* ------------------------------------------------------------------ */
/*  Create empty KeyResource entries on upload                         */
/* ------------------------------------------------------------------ */

/** Key computation — must match video-workflow MCP tools exactly. */
function portraitKey(name: string): string {
  return `char_${name.toLowerCase().replace(/\s+/g, "_")}_portrait`;
}
function sceneKey(sceneName: string): string {
  return `scene_${sceneName.replace(/\s+/g, "_")}`;
}
function sceneGridKey(sceneName: string): string {
  return `scene_${sceneName.replace(/\s+/g, "_")}_grid`;
}
function costumeKey(name: string): string {
  return `costume_${name.toLowerCase().replace(/\s+/g, "_")}`;
}

/**
 * Ensure correct structure exists, then backfill progress from DB.
 *
 * Flow:
 *   1. Snapshot existing keys (for isNew detection)
 *   2. Compute expected structure from upload data
 *   3. Upsert all expected KeyResources
 *   4. Query currentVersion for each to determine generated/pending
 *   5. Identify stale resources (exist in DB but not in expected structure)
 */
async function createEmptyKeyResourcesWithDiff(
  novelId: string,
  upload: NovelScriptUpload,
  createdEpisodes: EpisodeSummary[],
): Promise<ResourceDiff> {
  // 1. Snapshot existing keys BEFORE upsert — for isNew flag
  const scriptIds = createdEpisodes.map((e) => e.id);
  const existingNovel = await prisma.keyResource.findMany({
    where: { scopeType: "novel", scopeId: novelId },
    select: { key: true, category: true, title: true, scopeType: true, scopeId: true },
  });
  const existingScript = scriptIds.length > 0
    ? await prisma.keyResource.findMany({
        where: { scopeType: "script", scopeId: { in: scriptIds } },
        select: { key: true, category: true, title: true, scopeType: true, scopeId: true },
      })
    : [];
  const existingKeys = new Set(
    [...existingNovel, ...existingScript].map((r) => `${r.scopeType}:${r.scopeId}:${r.key}`),
  );

  // 2. Compute expected structure from upload data
  const expectedMeta = computeExpectedKeys(novelId, upload, createdEpisodes);
  const expectedKeySet = new Set(expectedMeta.map((i) => `${i.scopeType}:${i.scopeId}:${i.key}`));

  // 3. Upsert all expected KeyResources
  await createEmptyKeyResources(novelId, upload, createdEpisodes);

  // 4. Query currentVersion for all expected resources (after upsert)
  const novelResources = await prisma.keyResource.findMany({
    where: { scopeType: "novel", scopeId: novelId },
    select: { key: true, scopeType: true, scopeId: true, currentVersion: true },
  });
  const scriptResources = scriptIds.length > 0
    ? await prisma.keyResource.findMany({
        where: { scopeType: "script", scopeId: { in: scriptIds } },
        select: { key: true, scopeType: true, scopeId: true, currentVersion: true },
      })
    : [];
  const versionMap = new Map<string, number>();
  for (const r of [...novelResources, ...scriptResources]) {
    versionMap.set(`${r.scopeType}:${r.scopeId}:${r.key}`, r.currentVersion);
  }

  // Build expected list with status + isNew
  const expected: ResourceDiffItem[] = expectedMeta.map((item) => {
    const compositeKey = `${item.scopeType}:${item.scopeId}:${item.key}`;
    const currentVersion = versionMap.get(compositeKey) ?? 0;
    return {
      ...item,
      status: currentVersion > 0 ? "generated" as const : "pending" as const,
      isNew: !existingKeys.has(compositeKey),
    };
  });

  // 5. Identify and clean up stale resources
  const stale: StaleResourceItem[] = [];
  for (const r of [...existingNovel, ...existingScript]) {
    const compositeKey = `${r.scopeType}:${r.scopeId}:${r.key}`;
    if (!expectedKeySet.has(compositeKey)) {
      const version = versionMap.get(compositeKey) ?? 0;
      if (version === 0) {
        // Never generated — safe to auto-delete
        await prisma.keyResource.deleteMany({
          where: { scopeType: r.scopeType, scopeId: r.scopeId, key: r.key },
        });
      } else {
        // Has generated content — keep for manual review
        stale.push({
          key: r.key,
          category: r.category ?? "",
          title: r.title ?? r.key,
          scopeType: r.scopeType,
          scopeId: r.scopeId,
        });
      }
    }
  }

  return { expected, stale };
}

/**
 * Compute expected resource metadata from upload data.
 * Pure computation — no DB writes, no status.
 */
function computeExpectedKeys(
  novelId: string,
  upload: NovelScriptUpload,
  createdEpisodes: EpisodeSummary[],
): Array<{ key: string; category: string; title: string; scopeType: string; scopeId: string }> {
  const items: Array<{ key: string; category: string; title: string; scopeType: string; scopeId: string }> = [];

  // Portraits
  for (const arc of upload.character_arcs ?? []) {
    items.push({ key: portraitKey(arc.name), category: "角色立绘", title: arc.name, scopeType: "novel", scopeId: novelId });
  }

  // Scenes + grids
  const locations = upload.location_bible ?? [];
  const allSceneNames = new Set<string>();
  const gridParents: string[] = [];
  for (const loc of locations) {
    if (loc.visual_prompt?.trim()) allSceneNames.add(loc.name);
    const realSubs = (loc.sub_locations ?? []).filter((sub) => sub.id !== loc.id);
    if (realSubs.length >= 2) gridParents.push(loc.name);
    for (const sub of loc.sub_locations ?? []) {
      if (sub.visual_prompt?.trim()) allSceneNames.add(sub.name);
    }
  }
  for (const name of allSceneNames) {
    items.push({ key: sceneKey(name), category: "场景", title: name, scopeType: "novel", scopeId: novelId });
  }
  for (const name of gridParents) {
    items.push({ key: sceneGridKey(name), category: "场景", title: `${name} (grid)`, scopeType: "novel", scopeId: novelId });
  }

  // Costumes
  const episodes = upload.episodes;
  for (let i = 0; i < episodes.length; i++) {
    const ep = episodes[i]!;
    const scriptId = createdEpisodes[i]?.id;
    if (!scriptId) continue;
    const outfits = ep.output.character_outfits;
    if (!outfits) continue;
    for (const name of Object.keys(outfits)) {
      items.push({ key: costumeKey(name), category: "换装", title: name, scopeType: "script", scopeId: scriptId });
    }
  }

  return items;
}

/**
 * Create empty KeyResource entries for all characters, scenes, and costumes.
 * Characters and scenes come from novel-level data (character_arcs, location_bible).
 * Costumes still come per-episode from character_outfits.
 * Uses upsert to be idempotent.
 */
async function createEmptyKeyResources(
  novelId: string,
  upload: NovelScriptUpload,
  createdEpisodes: EpisodeSummary[],
): Promise<void> {
  // Novel-level: portraits from character_arcs
  const characterArcs = upload.character_arcs ?? [];
  for (const arc of characterArcs) {
    await prisma.keyResource.upsert({
      where: { scopeType_scopeId_key: { scopeType: "novel", scopeId: novelId, key: portraitKey(arc.name) } },
      create: {
        scopeType: "novel",
        scopeId: novelId,
        key: portraitKey(arc.name),
        mediaType: "image",
        category: "角色立绘",
        title: arc.name,
      },
      update: { category: "角色立绘", title: arc.name },
    });
  }

  // Novel-level: scenes from location_bible (including sub_locations)
  // Also creates grid entries for parent locations with >1 real sub-locations.
  const locations = upload.location_bible ?? [];
  const allSceneNames = new Set<string>();
  const gridParents: Array<{ name: string }> = [];
  for (const loc of locations) {
    // Parent location
    if (loc.visual_prompt?.trim()) {
      allSceneNames.add(loc.name);
    }
    // Determine real sub-locations (id differs from parent)
    const realSubs = (loc.sub_locations ?? []).filter(
      (sub) => sub.id !== loc.id,
    );
    if (realSubs.length >= 2) {
      gridParents.push({ name: loc.name });
    }
    // Sub-locations
    for (const sub of loc.sub_locations ?? []) {
      if (sub.visual_prompt?.trim()) {
        allSceneNames.add(sub.name);
      }
    }
  }
  for (const sceneName of allSceneNames) {
    await prisma.keyResource.upsert({
      where: { scopeType_scopeId_key: { scopeType: "novel", scopeId: novelId, key: sceneKey(sceneName) } },
      create: {
        scopeType: "novel",
        scopeId: novelId,
        key: sceneKey(sceneName),
        mediaType: "image",
        category: "场景",
        title: sceneName,
      },
      update: { category: "场景", title: sceneName },
    });
  }
  // Grid entries for parent locations eligible for grid mode
  for (const parent of gridParents) {
    await prisma.keyResource.upsert({
      where: { scopeType_scopeId_key: { scopeType: "novel", scopeId: novelId, key: sceneGridKey(parent.name) } },
      create: {
        scopeType: "novel",
        scopeId: novelId,
        key: sceneGridKey(parent.name),
        mediaType: "image",
        category: "场景",
        title: `${parent.name} (grid)`,
      },
      update: { category: "场景", title: `${parent.name} (grid)` },
    });
  }

  // EP-level: costumes (per episode, from character_outfits)
  const episodes = upload.episodes;
  for (let i = 0; i < episodes.length; i++) {
    const ep = episodes[i]!;
    const scriptId = createdEpisodes[i]?.id;
    if (!scriptId) continue;
    const outfits = ep.output.character_outfits;
    if (!outfits) continue;
    for (const name of Object.keys(outfits)) {
      await prisma.keyResource.upsert({
        where: { scopeType_scopeId_key: { scopeType: "script", scopeId: scriptId, key: costumeKey(name) } },
        create: {
          scopeType: "script",
          scopeId: scriptId,
          key: costumeKey(name),
          mediaType: "image",
          category: "换装",
          title: name,
        },
        update: { category: "换装", title: name },
      });
    }
  }
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
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb)
       RETURNING id, created_at`,
      [
        novelId,
        scriptKey,
        ep.output.episode_title,
        ep.output.pre_choice_script,
        JSON.stringify(ep.output),
      JSON.stringify(ep.output.characters),
        JSON.stringify(ep.output.character_outfits ?? {}),
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

/* ------------------------------------------------------------------ */
/*  Novel-level data                                                   */
/* ------------------------------------------------------------------ */

export interface NovelLevelData {
  characterArcs: Array<Record<string, unknown>>;
  locationBible: Array<Record<string, unknown>>;
  synopsis: Record<string, unknown> | null;
}

/**
 * Read novel-level data (character_arcs, location_bible, synopsis) from novels table.
 */
export async function getNovelLevelData(novelId: string): Promise<NovelLevelData> {
  const tNovels = await physical("novels");
  const { rows } = await bizPool.query(
    `SELECT character_arcs, location_bible, synopsis FROM "${tNovels}" WHERE id = $1 LIMIT 1`,
    [novelId],
  );
  const row = rows[0] as { character_arcs: unknown; location_bible: unknown; synopsis: unknown } | undefined;
  if (!row) return { characterArcs: [], locationBible: [], synopsis: null };

  const parse = (v: unknown): Array<Record<string, unknown>> | Record<string, unknown> | null => {
    if (v == null) return null;
    if (typeof v === "string") { try { return JSON.parse(v) as Array<Record<string, unknown>>; } catch { return null; } }
    return v as Array<Record<string, unknown>> | Record<string, unknown>;
  };

  const arcs = parse(row.character_arcs);
  const locs = parse(row.location_bible);
  const syn = parse(row.synopsis);

  return {
    characterArcs: Array.isArray(arcs) ? arcs : [],
    locationBible: Array.isArray(locs) ? locs : [],
    synopsis: (syn && !Array.isArray(syn)) ? syn : null,
  };
}

/* ------------------------------------------------------------------ */
/*  Scene structure analysis (shared with MCP provider)                 */
/* ------------------------------------------------------------------ */

export interface LocationSub {
  id: string;
  name: string;
  visualPrompt: string;
  description: string;
}

export interface AnalyzedLocation {
  id: string;
  name: string;
  visualPrompt: string;
  description: string;
  mode: "grid" | "single";
  gridSize: number;
  realSubs: LocationSub[];
}

/**
 * Analyze location_bible entries and determine grid/single mode.
 * Grid mode: parent has ≥ 2 real sub-locations (id differs from parent).
 * A single sub-location uses single mode — no need for a grid.
 */
export function analyzeLocations(
  locationBible: Array<Record<string, unknown>>,
): AnalyzedLocation[] {
  return locationBible.map((loc) => {
    const parentId = String(loc.id ?? "");
    const subs = (loc.sub_locations as Array<Record<string, unknown>> | undefined) ?? [];
    const realSubs = subs
      .filter((s) => String(s.id ?? "") !== parentId)
      .map((s): LocationSub => ({
        id: String(s.id ?? ""),
        name: String(s.name ?? ""),
        visualPrompt: String(s.visual_prompt ?? ""),
        description: String(s.description ?? ""),
      }));
    const mode = realSubs.length >= 2 ? "grid" as const : "single" as const;
    return {
      id: parentId,
      name: String(loc.name ?? ""),
      visualPrompt: String(loc.visual_prompt ?? ""),
      description: String(loc.description ?? ""),
      mode,
      gridSize: mode === "grid" ? realSubs.length + 1 : 1,
      realSubs,
    };
  });
}

/* ------------------------------------------------------------------ */
/*  Prompt Preview                                                     */
/* ------------------------------------------------------------------ */

export interface CharacterPreview {
  name: string;
  gender: string | null;
  age: string | null;
  appearance: string | null;
  personality: string | null;
  socialStatus: string | null;
  compiledPrompt: string | null;   // null when styleName not provided
  portraitUrl: string | null;
}

export interface ScenePreview {
  name: string;
  visualPrompt: string | null;
  description: string | null;
  compiledPrompt: string | null;
  mode: "single" | "grid" | "hd";
  imageUrl: string | null;
  parentName: string | null;       // null for top-level locations
}

export interface PromptPreviewResult {
  characters: CharacterPreview[];
  scenes: ScenePreview[];
}

/** Default StylePreset names per generation mode — match the conventions in style-preset skill. */
const DEFAULT_PORTRAIT_STYLE = "portrait-style";
const DEFAULT_SINGLE_STYLE = "location_style";
const DEFAULT_GRID_STYLE = "location_grid_style";
const DEFAULT_HD_STYLE = "sub_location_style";

/**
 * Build a prompt preview for all characters and scenes in a novel.
 * portraitStyleName / sceneStyleName select the style for each category.
 * Defaults are applied if omitted. Pass explicit `null` to skip compilation.
 */
export async function getPromptPreview(
  novelId: string,
  portraitStyleName?: string | null,
  sceneStyleName?: string | null,
): Promise<PromptPreviewResult> {
  const { characterArcs, locationBible } = await getNovelLevelData(novelId);

  const stylePresetSvc = await import("@/lib/services/style-preset-service");

  // Resolve portrait style (use default if undefined, skip if null)
  let portraitStylePrompt: string | null = null;
  const resolvedPortraitName = portraitStyleName === undefined ? DEFAULT_PORTRAIT_STYLE : portraitStyleName;
  if (resolvedPortraitName) {
    const preset = await stylePresetSvc.getByName(resolvedPortraitName);
    if (preset) portraitStylePrompt = preset.prompt;
  }

  // Resolve scene styles per mode
  let singleStylePrompt: string | null = null;
  const resolvedSingleName = sceneStyleName === undefined ? DEFAULT_SINGLE_STYLE : sceneStyleName;
  if (resolvedSingleName) {
    const preset = await stylePresetSvc.getByName(resolvedSingleName);
    if (preset) singleStylePrompt = preset.prompt;
  }

  let gridStylePrompt: string | null = null;
  {
    const preset = await stylePresetSvc.getByName(DEFAULT_GRID_STYLE);
    if (preset) gridStylePrompt = preset.prompt;
  }

  let hdStylePrompt: string | null = null;
  {
    const preset = await stylePresetSvc.getByName(DEFAULT_HD_STYLE);
    if (preset) hdStylePrompt = preset.prompt;
  }

  // Fetch portrait URLs in batch
  const portraitResources = await prisma.keyResource.findMany({
    where: { scopeType: "novel", scopeId: novelId, category: "角色立绘" },
    include: { versions: { orderBy: { version: "desc" }, take: 1 } },
  });
  const portraitUrlByTitle = new Map<string, string | null>();
  for (const r of portraitResources) {
    if (r.title) portraitUrlByTitle.set(r.title, r.versions[0]?.url ?? null);
  }

  // Fetch scene URLs in batch
  const sceneResources = await prisma.keyResource.findMany({
    where: { scopeType: "novel", scopeId: novelId, category: "场景" },
    include: { versions: { orderBy: { version: "desc" }, take: 1 } },
  });
  const sceneUrlByTitle = new Map<string, string | null>();
  for (const r of sceneResources) {
    if (r.title) sceneUrlByTitle.set(r.title, r.versions[0]?.url ?? null);
  }

  // Build character previews
  const { compileTemplate } = await import("@/lib/mcp/static/langfuse-helpers");
  const characters: CharacterPreview[] = [];
  for (const arc of characterArcs) {
    const name = String(arc.name ?? "");
    const gender = arc.gender ? String(arc.gender) : null;
    const age = arc.age ? String(arc.age) : null;
    const appearance = arc.appearance ? String(arc.appearance) : null;
    const personality = arc.personality ? String(arc.personality) : null;
    const socialStatus = arc.socialStatus ?? arc.social_status;
    const socialStatusStr = socialStatus ? String(socialStatus) : null;

    let compiledPrompt: string | null = null;
    if (portraitStylePrompt && appearance) {
      compiledPrompt = compileTemplate(portraitStylePrompt, { demographics: appearance });
    }

    characters.push({
      name,
      gender,
      age,
      appearance,
      personality,
      socialStatus: socialStatusStr,
      compiledPrompt,
      portraitUrl: portraitUrlByTitle.get(name) ?? null,
    });
  }

  // Analyze locations to determine mode per parent
  const analyzed = analyzeLocations(locationBible);

  // Build scene previews (mode-aware)
  const scenes: ScenePreview[] = [];
  for (const loc of analyzed) {
    if (loc.mode === "single") {
      // Single mode: parent with no real sub-locations
      let compiled: string | null = null;
      if (singleStylePrompt && loc.visualPrompt) {
        compiled = compileTemplate(singleStylePrompt, { name: loc.name, scenePrompt: loc.visualPrompt });
      }
      scenes.push({
        name: loc.name,
        visualPrompt: loc.visualPrompt || null,
        description: loc.description || null,
        compiledPrompt: compiled,
        mode: "single",
        imageUrl: sceneUrlByTitle.get(loc.name) ?? null,
        parentName: null,
      });
    } else {
      // Grid mode: parent with real sub-locations → compile grid prompt
      let gridCompiled: string | null = null;
      if (gridStylePrompt) {
        const slots = [
          `【格 1】${loc.name}：${loc.visualPrompt}`,
          ...loc.realSubs.map((sub, i) => `【格 ${i + 2}】${sub.name}：${sub.visualPrompt}`),
        ];
        gridCompiled = compileTemplate(gridStylePrompt, {
          name: loc.name,
          gridSize: String(loc.gridSize),
          gridSlots: slots.join("\n"),
        });
      }
      scenes.push({
        name: loc.name,
        visualPrompt: loc.visualPrompt || null,
        description: loc.description || null,
        compiledPrompt: gridCompiled,
        mode: "grid",
        imageUrl: sceneUrlByTitle.get(loc.name) ?? null,
        parentName: null,
      });

      // HD mode for each real sub-location
      for (const sub of loc.realSubs) {
        let hdCompiled: string | null = null;
        if (hdStylePrompt) {
          hdCompiled = compileTemplate(hdStylePrompt, { name: sub.name, sceneName: sub.name });
        }
        scenes.push({
          name: sub.name,
          visualPrompt: sub.visualPrompt || null,
          description: sub.description || null,
          compiledPrompt: hdCompiled,
          mode: "hd",
          imageUrl: sceneUrlByTitle.get(sub.name) ?? null,
          parentName: loc.name,
        });
      }
    }
  }

  return { characters, scenes };
}

/**
 * Update a single field in character_arcs or location_bible.
 * Operates on the JSONB array in the novels table.
 */
export async function updateNovelField(
  novelId: string,
  target: "character" | "location" | "sub_location",
  name: string,
  field: string,
  value: string,
  parentName?: string, // required for sub_location
): Promise<void> {
  const { characterArcs, locationBible } = await getNovelLevelData(novelId);
  const tNovels = await physical("novels");

  if (target === "character") {
    const arc = characterArcs.find((a) => String(a.name) === name);
    if (!arc) throw new Error(`Character "${name}" not found`);
    arc[field] = value;
    await bizPool.query(
      `UPDATE "${tNovels}" SET character_arcs = $1::jsonb WHERE id = $2`,
      [JSON.stringify(characterArcs), novelId],
    );
  } else if (target === "location") {
    const loc = locationBible.find((l) => String(l.name) === name);
    if (!loc) throw new Error(`Location "${name}" not found`);
    loc[field] = value;
    await bizPool.query(
      `UPDATE "${tNovels}" SET location_bible = $1::jsonb WHERE id = $2`,
      [JSON.stringify(locationBible), novelId],
    );
  } else {
    // sub_location
    if (!parentName) throw new Error("parentName required for sub_location");
    const parent = locationBible.find((l) => String(l.name) === parentName);
    if (!parent) throw new Error(`Parent location "${parentName}" not found`);
    const subs = parent.sub_locations as Array<Record<string, unknown>> | undefined;
    if (!subs) throw new Error(`No sub_locations in "${parentName}"`);
    const sub = subs.find((s) => String(s.name) === name);
    if (!sub) throw new Error(`Sub-location "${name}" not found in "${parentName}"`);
    sub[field] = value;
    await bizPool.query(
      `UPDATE "${tNovels}" SET location_bible = $1::jsonb WHERE id = $2`,
      [JSON.stringify(locationBible), novelId],
    );
  }
}

/* ------------------------------------------------------------------ */
/*  Episode status                                                     */
/* ------------------------------------------------------------------ */

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

  // Check KeyResource for any generated resources in this script scope
  const krCount = await prisma.keyResource.count({
    where: { scopeType: "script", scopeId: scriptId, currentVersion: { gt: 0 } },
  });
  return krCount > 0 ? "has_resources" : "uploaded";
}
