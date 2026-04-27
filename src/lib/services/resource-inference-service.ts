/**
 * Resource Inference Service - Expected resource computation and management
 * 
 * This service handles:
 * - Computing expected resources from script uploads
 * - Computing expected resources from stored data
 * - Creating and upserting expected resources
 * - Resource diff computation (expected vs existing)
 */

import { prisma } from "@/lib/db";
import type {
  ExpectedResourceMeta,
  ExistingKeyResourceMeta,
  ResourceDiff,
  ResourceDiffItem,
  StaleResourceItem,
} from "@/lib/video/resource-types";
import type { EpisodeSummary } from "@/lib/video/episode-types";
import type { ScriptEpisode, NovelScriptUpload } from "@/lib/video/script-upload-schema";
import {
  portraitKey,
  sceneKey,
  sceneGridKey,
  costumeKey,
  isRecord,
  parseArray,
  parseRecord,
} from "@/lib/video/resource-key-utils";

/* ------------------------------------------------------------------ */
/*  Expected resource builders                                         */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/*  Key resource metadata queries                                      */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/*  Expected resource computation from uploads                         */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/*  Expected resource computation from stored data                     */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/*  Resource upsert operations                                         */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/*  Public API: Resource diff computation                              */
/* ------------------------------------------------------------------ */

export async function createEmptyKeyResourcesWithDiff(
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

/* ------------------------------------------------------------------ */
/*  Public API: Ensure expected resources                             */
/* ------------------------------------------------------------------ */

export async function ensureExpectedNovelResources(novelId: string): Promise<void> {
  await upsertExpectedResources(await computeStoredExpectedKeys(novelId, new Set<string>()));
}

export async function ensureExpectedEpisodeResources(
  novelId: string,
  scriptId: string,
): Promise<void> {
  await upsertExpectedResources(await computeStoredExpectedKeys(novelId, new Set([scriptId])));
}
