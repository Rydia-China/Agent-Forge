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
import type { NovelScriptUpload } from "@/lib/video/script-upload-schema";
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

function addOutfitsFromValue(
  items: ExpectedResourceMeta[],
  seen: Set<string>,
  scriptId: string,
  value: unknown,
  nameMapping?: Map<string, string>,
): void {
  const outfits = parseRecord(value);
  if (!outfits) return;
  for (const name of Object.keys(outfits)) {
    const normalizedName = nameMapping?.get(name) ?? name;
    addScriptCostumeResource(items, seen, scriptId, normalizedName);
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
/*  Helper: Build character name mapping (short name -> full name)    */
/* ------------------------------------------------------------------ */

function buildCharacterNameMapping(characterArcs: unknown): Map<string, string> {
  const mapping = new Map<string, string>();
  for (const arc of parseArray(characterArcs)) {
    if (!isRecord(arc)) continue;
    const fullName = arc.name;
    if (typeof fullName !== "string") continue;
    
    // Map full name to itself
    mapping.set(fullName, fullName);
    
    // Extract first name (before first space) and map to full name
    const firstName = fullName.split(/\s+/)[0];
    if (firstName && firstName !== fullName) {
      mapping.set(firstName, fullName);
    }
  }
  return mapping;
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

  // Build name mapping from character arcs
  const nameMapping = buildCharacterNameMapping(upload.character_arcs);

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
    // Episode data may reference local characters/scenes, but it only creates script-scope resources.
    const outfits = episode.output.character_outfits;
    if (outfits) addOutfitsFromValue(items, seen, scriptId, outfits, nameMapping);
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

  const scripts = scriptScopeIds.size > 0
    ? await prisma.novelScript.findMany({
        where: { novelId, id: { in: Array.from(scriptScopeIds) } },
        select: { id: true, initResult: true, costumes: true },
      })
    : [];

  const items: ExpectedResourceMeta[] = [];
  const seen = new Set<string>();

  // Build name mapping from character arcs
  const nameMapping = buildCharacterNameMapping(novel?.characterArcs);

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
    // Stored episode data may only add script-scoped resources for the requested script.
    if (scriptScopeIds.has(scriptId)) {
      addOutfitsFromValue(items, seen, scriptId, initResult?.character_outfits ?? script.costumes, nameMapping);
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
