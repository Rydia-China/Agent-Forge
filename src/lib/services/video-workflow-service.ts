/**
 * Video Workflow Service — data access for the video UI.
 *
 * Uses domain_resources (generic) + novel_scripts (episode container).
 * No business concepts (characters, costumes, scenes, shots) in code.
 */

import crypto from "node:crypto";
import { bizPool } from "@/lib/biz-db";
import { resolveTable, GLOBAL_USER } from "@/lib/biz-db-namespace";
import { ensureVideoSchema } from "@/lib/video/schema";
import { prisma } from "@/lib/db";
import type { ScriptEpisode, NovelScriptUpload } from "@/lib/video/script-upload-schema";
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
import { registry } from "@/lib/mcp/registry";

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
export interface ResourceDiffItem {
  key: string;
  category: string;
  title: string;
  scopeType: string;
  scopeId: string;
  status: "generated" | "pending";
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
  expected: ResourceDiffItem[];
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
  return (rows as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    episodeCount: row.episode_count as number,
    createdAt: String(row.created_at),
  }));
}

export async function deleteNovel(novelId: string): Promise<void> {
  const tNovels = await physical("novels");
  const tScripts = await physical("novel_scripts");

  const { rows: episodeRows } = await bizPool.query(
    `SELECT id FROM "${tScripts}" WHERE novel_id = $1`,
    [novelId],
  );
  for (const row of episodeRows as Array<{ id: string }>) {
    await deleteEpisode(row.id);
  }

  await prisma.keyResource.deleteMany({ where: { scopeType: "novel", scopeId: novelId } });
  await deleteResourcesByScope("novel", novelId);
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
      const keyResourceCount = await prisma.keyResource.count({
        where: { scopeType: "script", scopeId: scriptId, currentVersion: { gt: 0 } },
      });
      hasResources = keyResourceCount > 0;
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

/* ------------------------------------------------------------------ */
/*  Batch upload                                                       */
/* ------------------------------------------------------------------ */

/**
 * Create a new novel and insert all episodes from a validated JSON upload.
 * Novel-level data is stored on the novels row, and expected video resources
 * are initialized as empty KeyResource identities.
 */
export async function createNovelWithScript(
  name: string,
  upload: NovelScriptUpload,
): Promise<{ novelId: string; episodes: EpisodeSummary[]; diff: ResourceDiff }> {
  const tNovels = await physical("novels");
  const tScripts = await physical("novel_scripts");
  const episodes = upload.episodes ?? [];

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

  const created = await insertEpisodes(tScripts, novelId, episodes);
  const diff = await createEmptyKeyResourcesWithDiff(novelId, upload, created);

  return { novelId, episodes: created, diff };
}

/**
 * Replace source data for an existing novel from a validated JSON upload.
 * Produced KeyResources are preserved; new expected resources are initialized.
 */
export async function replaceNovelScript(
  novelId: string,
  upload: NovelScriptUpload,
): Promise<{ episodes: EpisodeSummary[]; diff: ResourceDiff }> {
  const tNovels = await physical("novels");
  const tScripts = await physical("novel_scripts");
  const episodes = upload.episodes ?? [];

  const newByKey = new Map<string, ScriptEpisode>();
  for (const episode of episodes) {
    newByKey.set(scriptKeyForEpisode(episode), episode);
  }

  const { rows: existingRows } = await bizPool.query(
    `SELECT id, script_key, created_at FROM "${tScripts}" WHERE novel_id = $1`,
    [novelId],
  );
  const existingByKey = new Map<string, { id: string; createdAt: string }>();
  for (const row of existingRows as Array<{ id: string; script_key: string; created_at: string }>) {
    existingByKey.set(row.script_key, { id: row.id, createdAt: String(row.created_at) });
  }

  for (const [key, { id }] of existingByKey) {
    if (!newByKey.has(key)) {
      await bizPool.query(`DELETE FROM "${tScripts}" WHERE id = $1`, [id]);
    }
  }

  const result: EpisodeSummary[] = [];
  for (const episode of episodes) {
    const scriptKey = scriptKeyForEpisode(episode);
    const existing = existingByKey.get(scriptKey);

    if (existing) {
      await bizPool.query(
        `UPDATE "${tScripts}"
         SET script_name = $1, script_content = $2,
             init_result = $3::jsonb, characters = $4::jsonb, costumes = $5::jsonb
         WHERE id = $6`,
        [
          episode.output.episode_title,
          episode.output.pre_choice_script,
          JSON.stringify(episode.output),
          JSON.stringify(episode.output.characters),
          JSON.stringify(episode.output.character_outfits ?? {}),
          existing.id,
        ],
      );
      result.push({
        id: existing.id,
        novelId,
        scriptKey,
        scriptName: episode.output.episode_title,
        status: "uploaded",
        createdAt: existing.createdAt,
      });
    } else {
      const { rows } = await bizPool.query(
        `INSERT INTO "${tScripts}"
          (novel_id, script_key, script_name, script_content,
           init_result, characters, costumes)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb)
         RETURNING id, created_at`,
        [
          novelId,
          scriptKey,
          episode.output.episode_title,
          episode.output.pre_choice_script,
          JSON.stringify(episode.output),
          JSON.stringify(episode.output.characters),
          JSON.stringify(episode.output.character_outfits ?? {}),
        ],
      );
      const row = rows[0] as { id: string; created_at: string } | undefined;
      if (!row) throw new Error(`Failed to insert episode ${scriptKey}`);
      result.push({
        id: row.id,
        novelId,
        scriptKey,
        scriptName: episode.output.episode_title,
        status: "uploaded",
        createdAt: String(row.created_at),
      });
    }
  }

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

  const diff = await createEmptyKeyResourcesWithDiff(novelId, upload, result);

  return { episodes: result, diff };
}

export async function deleteEpisode(scriptId: string): Promise<void> {
  const tScripts = await physical("novel_scripts");

  // Look up novel_id + script_key to derive session userName
  const { rows: scriptRows } = await bizPool.query(
    `SELECT novel_id, script_key FROM "${tScripts}" WHERE id = $1 LIMIT 1`,
    [scriptId],
  );
  const scriptRow = scriptRows[0] as { novel_id: string; script_key: string } | undefined;

  // Delete script-scoped KeyResources and legacy domain_resources for this script
  await prisma.keyResource.deleteMany({ where: { scopeType: "script", scopeId: scriptId } });
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
/*  Create empty KeyResource entries on upload                         */
/* ------------------------------------------------------------------ */

interface ExpectedResourceMeta {
  key: string;
  category: string;
  title: string;
  scopeType: string;
  scopeId: string;
}

interface ExistingKeyResourceMeta {
  key: string;
  category: string | null;
  title: string | null;
  scopeType: string;
  scopeId: string;
  currentVersion: number;
}

function scriptKeyForEpisode(episode: ScriptEpisode): string {
  return episode.variant_kind === "mainline"
    ? `EP${episode.ep_num}`
    : `EP${episode.ep_num}-${episode.variant_kind}`;
}

/** Key computation — must match video workflow tools exactly. */
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
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  if (!value.trim()) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function parseRecord(value: unknown): Record<string, unknown> | null {
  const parsed = parseJsonValue(value);
  return isRecord(parsed) ? parsed : null;
}

function parseArray(value: unknown): unknown[] {
  const parsed = parseJsonValue(value);
  return Array.isArray(parsed) ? parsed : [];
}

function addExpectedResource(
  items: ExpectedResourceMeta[],
  seen: Set<string>,
  item: ExpectedResourceMeta,
): void {
  if (!item.key.trim() || !item.title.trim()) return;
  const compositeKey = `${item.scopeType}:${item.scopeId}:${item.key}`;
  if (seen.has(compositeKey)) return;
  seen.add(compositeKey);
  items.push(item);
}

function addNovelCharacterResource(
  items: ExpectedResourceMeta[],
  seen: Set<string>,
  novelId: string,
  name: string,
): void {
  const title = name.trim();
  if (!title) return;
  addExpectedResource(items, seen, {
    key: portraitKey(title),
    category: "角色立绘",
    title,
    scopeType: "novel",
    scopeId: novelId,
  });
}

function addNovelSceneResource(
  items: ExpectedResourceMeta[],
  seen: Set<string>,
  novelId: string,
  title: string,
): void {
  const normalizedTitle = title.trim();
  if (!normalizedTitle) return;
  addExpectedResource(items, seen, {
    key: sceneKey(normalizedTitle),
    category: "场景",
    title: normalizedTitle,
    scopeType: "novel",
    scopeId: novelId,
  });
}

function addNovelSceneGridResource(
  items: ExpectedResourceMeta[],
  seen: Set<string>,
  novelId: string,
  title: string,
): void {
  const normalizedTitle = title.trim();
  if (!normalizedTitle) return;
  addExpectedResource(items, seen, {
    key: sceneGridKey(normalizedTitle),
    category: "场景",
    title: `${normalizedTitle} (grid)`,
    scopeType: "novel",
    scopeId: novelId,
  });
}

function addScriptCostumeResource(
  items: ExpectedResourceMeta[],
  seen: Set<string>,
  scriptId: string,
  name: string,
): void {
  const title = name.trim();
  if (!title) return;
  addExpectedResource(items, seen, {
    key: costumeKey(title),
    category: "换装",
    title,
    scopeType: "script",
    scopeId: scriptId,
  });
}

function addCharactersFromValue(
  items: ExpectedResourceMeta[],
  seen: Set<string>,
  novelId: string,
  value: unknown,
): void {
  for (const name of parseArray(value)) {
    if (typeof name === "string") addNovelCharacterResource(items, seen, novelId, name);
  }
}

function addOutfitsFromValue(
  items: ExpectedResourceMeta[],
  seen: Set<string>,
  scriptId: string,
  value: unknown,
): void {
  const outfits = parseRecord(value);
  if (!outfits) return;
  for (const name of Object.keys(outfits)) {
    addScriptCostumeResource(items, seen, scriptId, name);
  }
}

function addSceneLocationsFromValue(
  items: ExpectedResourceMeta[],
  seen: Set<string>,
  novelId: string,
  value: unknown,
): void {
  const sceneLocations = parseRecord(value);
  if (!sceneLocations) return;

  for (const [name, rawScene] of Object.entries(sceneLocations)) {
    const scene = parseRecord(rawScene);
    const visualPrompt = scene?.visual_prompt;
    if (typeof visualPrompt === "string" && visualPrompt.trim()) {
      addNovelSceneResource(items, seen, novelId, name);
    }
  }
}

async function createEmptyKeyResourcesWithDiff(
  novelId: string,
  upload: NovelScriptUpload,
  createdEpisodes: EpisodeSummary[],
): Promise<ResourceDiff> {
  const scriptIds = createdEpisodes.map((episode) => episode.id);
  const existingNovel = await listKeyResourceMetaByScope("novel", novelId);
  const existingScript = await listKeyResourceMetaByScopeIds("script", scriptIds);
  const existingKeys = new Set(
    [...existingNovel, ...existingScript].map(
      (resource) => `${resource.scopeType}:${resource.scopeId}:${resource.key}`,
    ),
  );

  const expectedMeta = computeExpectedKeys(novelId, upload, createdEpisodes);
  const expectedKeySet = new Set(
    expectedMeta.map((item) => `${item.scopeType}:${item.scopeId}:${item.key}`),
  );

  await createEmptyKeyResources(novelId, upload, createdEpisodes);

  const novelResources = await listKeyResourceMetaByScope("novel", novelId);
  const scriptResources = await listKeyResourceMetaByScopeIds("script", scriptIds);
  const versionMap = new Map<string, number>();
  for (const resource of [...novelResources, ...scriptResources]) {
    versionMap.set(
      `${resource.scopeType}:${resource.scopeId}:${resource.key}`,
      resource.currentVersion,
    );
  }

  const expected: ResourceDiffItem[] = expectedMeta.map((item) => {
    const compositeKey = `${item.scopeType}:${item.scopeId}:${item.key}`;
    const currentVersion = versionMap.get(compositeKey) ?? 0;
    return {
      ...item,
      status: currentVersion > 0 ? "generated" : "pending",
      isNew: !existingKeys.has(compositeKey),
    };
  });

  const stale: StaleResourceItem[] = [];
  for (const resource of [...existingNovel, ...existingScript]) {
    const compositeKey = `${resource.scopeType}:${resource.scopeId}:${resource.key}`;
    if (expectedKeySet.has(compositeKey)) continue;

    const version = versionMap.get(compositeKey) ?? 0;
    if (version === 0) {
      await prisma.keyResource.deleteMany({
        where: {
          scopeType: resource.scopeType,
          scopeId: resource.scopeId,
          key: resource.key,
        },
      });
    } else {
      stale.push({
        key: resource.key,
        category: resource.category ?? "",
        title: resource.title ?? resource.key,
        scopeType: resource.scopeType,
        scopeId: resource.scopeId,
      });
    }
  }

  return { expected, stale };
}

function computeExpectedKeys(
  novelId: string,
  upload: NovelScriptUpload,
  createdEpisodes: EpisodeSummary[],
): ExpectedResourceMeta[] {
  const items: ExpectedResourceMeta[] = [];
  const seen = new Set<string>();

  for (const arc of upload.character_arcs ?? []) {
    addNovelCharacterResource(items, seen, novelId, arc.name);
  }

  const locations = upload.location_bible ?? [];
  const allSceneNames = new Set<string>();
  const gridParents: string[] = [];
  for (const location of locations) {
    if (location.visual_prompt?.trim()) allSceneNames.add(location.name);
    const realSubLocations = (location.sub_locations ?? []).filter(
      (subLocation) => subLocation.id !== location.id,
    );
    if (realSubLocations.length >= 2) gridParents.push(location.name);
    for (const subLocation of location.sub_locations ?? []) {
      if (subLocation.visual_prompt?.trim()) allSceneNames.add(subLocation.name);
    }
  }
  for (const name of allSceneNames) {
    addNovelSceneResource(items, seen, novelId, name);
  }
  for (const name of gridParents) {
    addNovelSceneGridResource(items, seen, novelId, name);
  }

  const episodes = upload.episodes ?? [];
  for (let index = 0; index < episodes.length; index++) {
    const episode = episodes[index];
    const scriptId = createdEpisodes[index]?.id;
    if (!episode || !scriptId) continue;
    addCharactersFromValue(items, seen, novelId, episode.output.characters);
    addSceneLocationsFromValue(items, seen, novelId, episode.output.scene_locations);
    const outfits = episode.output.character_outfits;
    if (outfits) addOutfitsFromValue(items, seen, scriptId, outfits);
  }

  return items;
}

async function listKeyResourceMetaByScope(
  scopeType: string,
  scopeId: string,
): Promise<ExistingKeyResourceMeta[]> {
  return prisma.$queryRaw<ExistingKeyResourceMeta[]>`
    SELECT
      key,
      category,
      title,
      "scopeType",
      "scopeId",
      "currentVersion"
    FROM "KeyResource"
    WHERE "scopeType" = ${scopeType}
      AND "scopeId" = ${scopeId}
  `;
}

async function listKeyResourceMetaByScopeIds(
  scopeType: string,
  scopeIds: string[],
): Promise<ExistingKeyResourceMeta[]> {
  if (scopeIds.length === 0) return [];
  return prisma.$queryRaw<ExistingKeyResourceMeta[]>`
    SELECT
      key,
      category,
      title,
      "scopeType",
      "scopeId",
      "currentVersion"
    FROM "KeyResource"
    WHERE "scopeType" = ${scopeType}
      AND "scopeId" = ANY(${scopeIds}::text[])
  `;
}

async function upsertExpectedResources(expectedResources: ExpectedResourceMeta[]): Promise<void> {
  for (const resource of expectedResources) {
    await prisma.$executeRaw`
      INSERT INTO "KeyResource" (
        id,
        "scopeType",
        "scopeId",
        key,
        "mediaType",
        category,
        title,
        "currentVersion",
        "createdAt",
        "updatedAt"
      )
      VALUES (
        ${crypto.randomUUID()},
        ${resource.scopeType},
        ${resource.scopeId},
        ${resource.key},
        'image',
        ${resource.category},
        ${resource.title},
        0,
        NOW(),
        NOW()
      )
      ON CONFLICT ("scopeType", "scopeId", key) DO UPDATE
      SET category = EXCLUDED.category,
          title = EXCLUDED.title,
          "updatedAt" = NOW()
    `;
  }
}

async function createEmptyKeyResources(
  novelId: string,
  upload: NovelScriptUpload,
  createdEpisodes: EpisodeSummary[],
): Promise<void> {
  await upsertExpectedResources(computeExpectedKeys(novelId, upload, createdEpisodes));
}

async function computeStoredExpectedKeys(
  novelId: string,
  scriptScopeIds: Set<string>,
): Promise<ExpectedResourceMeta[]> {
  const tNovels = await physical("novels");
  const tScripts = await physical("novel_scripts");

  const { rows: novelRows } = await bizPool.query(
    `SELECT character_arcs, location_bible FROM "${tNovels}" WHERE id = $1 LIMIT 1`,
    [novelId],
  );
  const { rows: scriptRows } = await bizPool.query(
    `SELECT id, init_result, characters, costumes FROM "${tScripts}" WHERE novel_id = $1`,
    [novelId],
  );

  const items: ExpectedResourceMeta[] = [];
  const seen = new Set<string>();
  const novelRow = (novelRows as Array<Record<string, unknown>>)[0];

  for (const arc of parseArray(novelRow?.character_arcs)) {
    if (!isRecord(arc)) continue;
    const name = arc.name;
    if (typeof name === "string") addNovelCharacterResource(items, seen, novelId, name);
  }

  for (const location of parseArray(novelRow?.location_bible)) {
    if (!isRecord(location)) continue;
    const name = location.name;
    const visualPrompt = location.visual_prompt;
    if (typeof name === "string" && typeof visualPrompt === "string" && visualPrompt.trim()) {
      addNovelSceneResource(items, seen, novelId, name);
    }

    const subLocations = parseArray(location.sub_locations);
    const realSubLocations = subLocations.filter((subLocation) => {
      if (!isRecord(subLocation)) return false;
      return subLocation.id !== location.id;
    });
    if (typeof name === "string" && realSubLocations.length >= 2) {
      addNovelSceneGridResource(items, seen, novelId, name);
    }

    for (const subLocation of subLocations) {
      if (!isRecord(subLocation)) continue;
      const subName = subLocation.name;
      const subVisualPrompt = subLocation.visual_prompt;
      if (typeof subName === "string" && typeof subVisualPrompt === "string" && subVisualPrompt.trim()) {
        addNovelSceneResource(items, seen, novelId, subName);
      }
    }
  }

  for (const row of scriptRows as Array<Record<string, unknown>>) {
    const scriptId = row.id;
    if (typeof scriptId !== "string") continue;

    const initResult = parseRecord(row.init_result);
    addCharactersFromValue(items, seen, novelId, initResult?.characters ?? row.characters);
    addSceneLocationsFromValue(items, seen, novelId, initResult?.scene_locations);

    if (scriptScopeIds.has(scriptId)) {
      addOutfitsFromValue(items, seen, scriptId, initResult?.character_outfits ?? row.costumes);
    }
  }

  return items;
}

export async function ensureExpectedNovelResources(novelId: string): Promise<void> {
  await upsertExpectedResources(await computeStoredExpectedKeys(novelId, new Set<string>()));
}

export async function ensureExpectedEpisodeResources(
  novelId: string,
  scriptId: string,
): Promise<void> {
  await upsertExpectedResources(await computeStoredExpectedKeys(novelId, new Set([scriptId])));
}

async function insertEpisodes(
  tScripts: string,
  novelId: string,
  episodes: ScriptEpisode[],
): Promise<EpisodeSummary[]> {
  const created: EpisodeSummary[] = [];
  for (const episode of episodes) {
    const scriptKey = scriptKeyForEpisode(episode);

    const { rows } = await bizPool.query(
      `INSERT INTO "${tScripts}"
        (novel_id, script_key, script_name, script_content,
         init_result, characters, costumes)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb)
       RETURNING id, created_at`,
      [
        novelId,
        scriptKey,
        episode.output.episode_title,
        episode.output.pre_choice_script,
        JSON.stringify(episode.output),
        JSON.stringify(episode.output.characters),
        JSON.stringify(episode.output.character_outfits ?? {}),
      ],
    );

    const row = rows[0] as { id: string; created_at: string } | undefined;
    if (!row) throw new Error(`Failed to insert episode ${scriptKey}`);

    created.push({
      id: row.id,
      novelId,
      scriptKey,
      scriptName: episode.output.episode_title,
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
  const row = rows[0] as {
    character_arcs: unknown;
    location_bible: unknown;
    synopsis: unknown;
  } | undefined;
  if (!row) return { characterArcs: [], locationBible: [], synopsis: null };

  const parse = (value: unknown): Array<Record<string, unknown>> | Record<string, unknown> | null => {
    if (value == null) return null;
    if (typeof value === "string") {
      try {
        return JSON.parse(value) as Array<Record<string, unknown>>;
      } catch {
        return null;
      }
    }
    return value as Array<Record<string, unknown>> | Record<string, unknown>;
  };

  const characterArcs = parse(row.character_arcs);
  const locationBible = parse(row.location_bible);
  const synopsis = parse(row.synopsis);

  return {
    characterArcs: Array.isArray(characterArcs) ? characterArcs : [],
    locationBible: Array.isArray(locationBible) ? locationBible : [],
    synopsis: synopsis && !Array.isArray(synopsis) ? synopsis : null,
  };
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

export async function runInitWorkflow(
  novelId: string,
  scriptDbId: string,
  scriptContent: string,
): Promise<InitWorkflowResult> {
  await initMcp();

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

  const keyResourceCount = await prisma.keyResource.count({
    where: { scopeType: "script", scopeId: scriptId, currentVersion: { gt: 0 } },
  });
  return keyResourceCount > 0 ? "has_resources" : "uploaded";
}
