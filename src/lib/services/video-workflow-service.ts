/**
 * Video Workflow Service — data access for the video UI.
 *
 * Uses Prisma models: Novel, NovelScript, DomainResource.
 * No business concepts (characters, costumes, scenes, shots) in code.
 */

import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma";
import type { ScriptEpisode, NovelScriptUpload } from "@/lib/video/script-upload-schema";
import { initMcp } from "@/lib/mcp/init";
import { registry } from "@/lib/mcp/registry";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface DomainResource {
  id: string;
  category: string;
  mediaType: string;
  title: string | null;
  url: string | null;
  data: unknown;
  keyResourceId: string | null;
  sortOrder: number;
}

export interface CategoryGroup {
  category: string;
  items: DomainResource[];
}

export interface DomainResources {
  categories: CategoryGroup[];
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
  const novels = await prisma.novel.findMany({
    orderBy: { createdAt: "desc" },
  });
  return novels.map((novel) => ({
    id: novel.id,
    name: novel.name,
    episodeCount: novel.episodeCount,
    createdAt: novel.createdAt.toISOString(),
  }));
}

export async function deleteNovel(novelId: string): Promise<void> {
  // Cascade delete: Novel -> NovelScript -> KeyResource, DomainResource, ChatSession
  // Get all script IDs first
  const scripts = await prisma.novelScript.findMany({
    where: { novelId },
    select: { id: true },
  });

  // Delete each episode (handles KeyResource, DomainResource, ChatSession cleanup)
  for (const script of scripts) {
    await deleteEpisode(script.id);
  }

  // Delete novel-scoped resources
  await prisma.keyResource.deleteMany({ where: { scopeType: "novel", scopeId: novelId } });
  await prisma.domainResource.deleteMany({ where: { scopeType: "novel", scopeId: novelId } });

  // Delete the novel itself (cascade deletes NovelScript via Prisma FK)
  await prisma.novel.delete({ where: { id: novelId } });
}

/* ------------------------------------------------------------------ */
/*  Episodes                                                           */
/* ------------------------------------------------------------------ */

export async function listEpisodes(novelId: string): Promise<EpisodeSummary[]> {
  const scripts = await prisma.novelScript.findMany({
    where: { novelId },
    orderBy: { scriptKey: "asc" },
  });

  const episodes: EpisodeSummary[] = [];
  for (const script of scripts) {
    const hasContent = script.scriptContent != null;

    // Check if any generated KeyResources exist for this script
    let hasResources = false;
    if (hasContent) {
      const keyResourceCount = await prisma.keyResource.count({
        where: { scopeType: "script", scopeId: script.id, currentVersion: { gt: 0 } },
      });
      hasResources = keyResourceCount > 0;
    }

    episodes.push({
      id: script.id,
      novelId: script.novelId,
      scriptKey: script.scriptKey,
      scriptName: script.scriptName,
      status: !hasContent ? "empty" : hasResources ? "has_resources" : "uploaded",
      createdAt: script.createdAt.toISOString(),
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
  const script = await prisma.novelScript.create({
    data: {
      novelId,
      scriptKey,
      scriptName,
      scriptContent,
    },
  });
  return { id: script.id };
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
  const episodes = upload.episodes ?? [];

  const novel = await prisma.novel.create({
    data: {
      name,
      episodeCount: episodes.length,
      synopsis: upload.synopsis as Prisma.InputJsonValue,
      characterArcs: upload.character_arcs as Prisma.InputJsonValue,
      locationBible: upload.location_bible as Prisma.InputJsonValue,
    },
  });

  const created = await insertEpisodes(novel.id, episodes);
  const diff = await createEmptyKeyResourcesWithDiff(novel.id, upload, created);

  return { novelId: novel.id, episodes: created, diff };
}

/**
 * Replace source data for an existing novel from a validated JSON upload.
 * Produced KeyResources are preserved; new expected resources are initialized.
 */
export async function replaceNovelScript(
  novelId: string,
  upload: NovelScriptUpload,
): Promise<{ episodes: EpisodeSummary[]; diff: ResourceDiff }> {
  const episodes = upload.episodes ?? [];

  const newByKey = new Map<string, ScriptEpisode>();
  for (const episode of episodes) {
    newByKey.set(scriptKeyForEpisode(episode), episode);
  }

  const existingScripts = await prisma.novelScript.findMany({
    where: { novelId },
    select: { id: true, scriptKey: true, createdAt: true },
  });

  const existingByKey = new Map<string, { id: string; createdAt: Date }>();
  for (const script of existingScripts) {
    existingByKey.set(script.scriptKey, { id: script.id, createdAt: script.createdAt });
  }

  // Delete scripts that are no longer in the upload
  for (const [key, { id }] of existingByKey) {
    if (!newByKey.has(key)) {
      await prisma.novelScript.delete({ where: { id } });
    }
  }

  const result: EpisodeSummary[] = [];
  for (const episode of episodes) {
    const scriptKey = scriptKeyForEpisode(episode);
    const existing = existingByKey.get(scriptKey);

    if (existing) {
      await prisma.novelScript.update({
        where: { id: existing.id },
        data: {
          scriptName: episode.output.episode_title,
          scriptContent: episode.output.pre_choice_script,
          initResult: episode.output as Prisma.InputJsonValue,
          characters: episode.output.characters as Prisma.InputJsonValue,
          costumes: (episode.output.character_outfits ?? {}) as Prisma.InputJsonValue,
        },
      });
      result.push({
        id: existing.id,
        novelId,
        scriptKey,
        scriptName: episode.output.episode_title,
        status: "uploaded",
        createdAt: existing.createdAt.toISOString(),
      });
    } else {
      const script = await prisma.novelScript.create({
        data: {
          novelId,
          scriptKey,
          scriptName: episode.output.episode_title,
          scriptContent: episode.output.pre_choice_script,
          initResult: episode.output as Prisma.InputJsonValue,
          characters: episode.output.characters as Prisma.InputJsonValue,
          costumes: (episode.output.character_outfits ?? {}) as Prisma.InputJsonValue,
        },
      });
      result.push({
        id: script.id,
        novelId,
        scriptKey,
        scriptName: episode.output.episode_title,
        status: "uploaded",
        createdAt: script.createdAt.toISOString(),
      });
    }
  }

  await prisma.novel.update({
    where: { id: novelId },
    data: {
      episodeCount: result.length,
      synopsis: upload.synopsis as Prisma.InputJsonValue,
      characterArcs: upload.character_arcs as Prisma.InputJsonValue,
      locationBible: upload.location_bible as Prisma.InputJsonValue,
    },
  });

  const diff = await createEmptyKeyResourcesWithDiff(novelId, upload, result);

  return { episodes: result, diff };
}

export async function deleteEpisode(scriptId: string): Promise<void> {
  // Look up novel_id + script_key to derive session userName
  const script = await prisma.novelScript.findUnique({
    where: { id: scriptId },
    select: { novelId: true, scriptKey: true },
  });

  // Delete script-scoped KeyResources and DomainResources
  await prisma.keyResource.deleteMany({ where: { scopeType: "script", scopeId: scriptId } });
  await prisma.domainResource.deleteMany({ where: { scopeType: "script", scopeId: scriptId } });

  // Delete the script itself
  await prisma.novelScript.delete({ where: { id: scriptId } });

  // Cascade-delete associated sessions (messages, tasks, events, key resources)
  if (script) {
    const userName = `video:${script.novelId}:${script.scriptKey}`;
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
  const novel = await prisma.novel.findUnique({
    where: { id: novelId },
    select: { characterArcs: true, locationBible: true },
  });

  const scripts = await prisma.novelScript.findMany({
    where: { novelId },
    select: { id: true, initResult: true, characters: true, costumes: true },
  });

  const items: ExpectedResourceMeta[] = [];
  const seen = new Set<string>();

  for (const arc of parseArray(novel?.characterArcs)) {
    if (!isRecord(arc)) continue;
    const name = arc.name;
    if (typeof name === "string") addNovelCharacterResource(items, seen, novelId, name);
  }

  for (const location of parseArray(novel?.locationBible)) {
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

  for (const script of scripts) {
    const scriptId = script.id;

    const initResult = parseRecord(script.initResult);
    addCharactersFromValue(items, seen, novelId, initResult?.characters ?? script.characters);
    addSceneLocationsFromValue(items, seen, novelId, initResult?.scene_locations);

    if (scriptScopeIds.has(scriptId)) {
      addOutfitsFromValue(items, seen, scriptId, initResult?.character_outfits ?? script.costumes);
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
  novelId: string,
  episodes: ScriptEpisode[],
): Promise<EpisodeSummary[]> {
  const created: EpisodeSummary[] = [];
  for (const episode of episodes) {
    const scriptKey = scriptKeyForEpisode(episode);

    const script = await prisma.novelScript.create({
      data: {
        novelId,
        scriptKey,
        scriptName: episode.output.episode_title,
        scriptContent: episode.output.pre_choice_script,
        initResult: episode.output as Prisma.InputJsonValue,
        characters: episode.output.characters as Prisma.InputJsonValue,
        costumes: (episode.output.character_outfits ?? {}) as Prisma.InputJsonValue,
      },
    });

    created.push({
      id: script.id,
      novelId,
      scriptKey,
      scriptName: episode.output.episode_title,
      status: "uploaded",
      createdAt: script.createdAt.toISOString(),
    });
  }
  return created;
}

/* ------------------------------------------------------------------ */
/*  Resources                                                          */
/* ------------------------------------------------------------------ */

/**
 * Get all resources for a given scope, grouped by category.
 * When a resource is linked to a KeyResource (keyResourceId), resolve
 * the URL from the KeyResource's current version so the panel always
 * reflects the active version (after rollback / regenerate).
 */
async function getResourcesByScope(
  scopeType: string,
  scopeId: string,
): Promise<CategoryGroup[]> {
  const resources = await prisma.domainResource.findMany({
    where: { scopeType, scopeId },
    orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
  });

  const domainResources: DomainResource[] = resources.map((r) => ({
    id: r.id,
    category: r.category,
    mediaType: r.mediaType,
    title: r.title,
    url: r.url,
    data: r.data,
    keyResourceId: r.keyResourceId,
    sortOrder: r.sortOrder,
  }));

  // Collect linked KeyResource IDs to resolve current-version URLs in a single query
  const linkedIds = domainResources
    .map((r) => r.keyResourceId)
    .filter((id): id is string => id != null);

  if (linkedIds.length > 0) {
    const keyResources = await prisma.keyResource.findMany({
      where: { id: { in: linkedIds } },
      include: { versions: { orderBy: { version: "asc" } } },
    });

    const urlMap = new Map<string, string | null>();
    for (const kr of keyResources) {
      const curVer = kr.versions.find((v) => v.version === kr.currentVersion);
      urlMap.set(kr.id, curVer?.url ?? null);
    }

    // Override static url with the current-version url from KeyResource
    for (const r of domainResources) {
      if (r.keyResourceId && urlMap.has(r.keyResourceId)) {
        r.url = urlMap.get(r.keyResourceId) ?? r.url;
      }
    }
  }

  const groups = new Map<string, DomainResource[]>();
  for (const r of domainResources) {
    const list = groups.get(r.category) ?? [];
    list.push(r);
    groups.set(r.category, list);
  }

  return [...groups.entries()].map(([category, items]) => ({ category, items }));
}

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
export async function updateResourceData(
  id: string,
  data: unknown,
): Promise<void> {
  await prisma.domainResource.update({
    where: { id },
    data: { data: data as Prisma.InputJsonValue },
  });
}

/**
 * Delete a single resource by id.
 */
export async function deleteResource(id: string): Promise<void> {
  const resource = await prisma.domainResource.findUnique({
    where: { id },
    select: { keyResourceId: true },
  });

  await prisma.domainResource.delete({ where: { id } });

  // Cascade-cleanup linked KeyResource
  if (resource?.keyResourceId) {
    await prisma.keyResource.delete({ where: { id: resource.keyResourceId } }).catch(() => {
      // Already gone — ignore
    });
  }
}

export async function getEpisodeContent(scriptId: string): Promise<string | null> {
  const script = await prisma.novelScript.findUnique({
    where: { id: scriptId },
    select: { scriptContent: true },
  });
  return script?.scriptContent ?? null;
}

/**
 * Read the stored init_result (full episode output JSON) for an episode.
 */
export async function getEpisodeOutput(
  scriptId: string,
): Promise<Record<string, unknown> | null> {
  const script = await prisma.novelScript.findUnique({
    where: { id: scriptId },
    select: { initResult: true },
  });
  if (!script?.initResult) return null;
  return script.initResult as Record<string, unknown>;
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
  const novel = await prisma.novel.findUnique({
    where: { id: novelId },
    select: { characterArcs: true, locationBible: true, synopsis: true },
  });

  if (!novel) return { characterArcs: [], locationBible: [], synopsis: null };

  const characterArcs = novel.characterArcs;
  const locationBible = novel.locationBible;
  const synopsis = novel.synopsis;

  return {
    characterArcs: Array.isArray(characterArcs) ? characterArcs as Array<Record<string, unknown>> : [],
    locationBible: Array.isArray(locationBible) ? locationBible as Array<Record<string, unknown>> : [],
    synopsis: synopsis && !Array.isArray(synopsis) ? synopsis as Record<string, unknown> : null,
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

  // Persist init_result + characters/costumes
  await prisma.novelScript.update({
    where: { id: scriptDbId },
    data: {
      initResult: parsed as unknown as Prisma.InputJsonValue,
      characters: (parsed.characters ?? []) as Prisma.InputJsonValue,
      costumes: (parsed.costumes ?? {}) as Prisma.InputJsonValue,
    },
  });

  return parsed;
}

/**
 * Read the stored init_result for an episode.
 */
export async function getInitResult(
  novelId: string,
  scriptKey: string,
): Promise<InitWorkflowResult | null> {
  const script = await prisma.novelScript.findFirst({
    where: { novelId, scriptKey },
    select: { initResult: true },
  });
  if (!script?.initResult) return null;
  return script.initResult as unknown as InitWorkflowResult;
}

export async function getEpisodeStatus(scriptId: string): Promise<EpStatus> {
  const script = await prisma.novelScript.findUnique({
    where: { id: scriptId },
    select: { scriptContent: true },
  });

  if (!script || !script.scriptContent) return "empty";

  const keyResourceCount = await prisma.keyResource.count({
    where: { scopeType: "script", scopeId: scriptId, currentVersion: { gt: 0 } },
  });
  return keyResourceCount > 0 ? "has_resources" : "uploaded";
}
