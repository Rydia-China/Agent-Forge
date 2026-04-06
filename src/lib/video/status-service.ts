/**
 * Video status queries — shared by MCP tools AND context providers.
 *
 * Single source of truth: KeyResource.
 *   - Total: KeyResource entries created at upload time (currentVersion == 0 = pending)
 *   - Done: KeyResource entries with currentVersion > 0 (has a generated version)
 *
 * NO init_result scanning. NO domain_resources. Pure Prisma queries.
 */

import { prisma } from "@/lib/db";
import { bizPool } from "@/lib/biz-db";
import { resolveTable, GLOBAL_USER } from "@/lib/biz-db-namespace";
import { ensureVideoSchema } from "@/lib/video/schema";
import { getNovelLevelData } from "@/lib/services/video-workflow-service";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

async function physical(logicalName: string): Promise<string> {
  await ensureVideoSchema();
  const resolved = await resolveTable(GLOBAL_USER, logicalName);
  if (!resolved) throw new Error(`Table "${logicalName}" not found`);
  return resolved.physicalName;
}

function parseJsonb(val: unknown): Record<string, unknown> | null {
  if (val == null) return null;
  if (typeof val === "object" && !Array.isArray(val)) return val as Record<string, unknown>;
  if (typeof val === "string") {
    try { return JSON.parse(val) as Record<string, unknown>; } catch { return null; }
  }
  return null;
}

/** Resolve current version URL for a KeyResource. */
async function resolveUrl(resourceId: string, currentVersion: number): Promise<string | null> {
  if (currentVersion === 0) return null;
  const ver = await prisma.keyResourceVersion.findUnique({
    where: { keyResourceId_version: { keyResourceId: resourceId, version: currentVersion } },
    select: { url: true },
  });
  return ver?.url ?? null;
}

/* ------------------------------------------------------------------ */
/*  Character status                                                   */
/* ------------------------------------------------------------------ */

export interface CharacterStatus {
  name: string;
  /** Merged description from novel-level character_arcs (appearance + personality + gender + socialStatus). */
  description: string;
  portraitUrl: string | null;
}

/** Merge key fields from a character arc into a single description string for portrait generation. */
function mergeCharacterDescription(arc: Record<string, unknown>): string {
  const parts: string[] = [];
  if (arc.gender) parts.push(String(arc.gender));
  if (arc.age) parts.push(String(arc.age));
  if (arc.appearance) parts.push(String(arc.appearance));
  if (arc.personality) parts.push(String(arc.personality));
  if (arc.socialStatus) parts.push(String(arc.socialStatus));
  return parts.join("\n");
}

export async function getCharacterStatuses(novelId: string): Promise<CharacterStatus[]> {
  // Portraits from KeyResource (created at upload)
  const portraits = await prisma.keyResource.findMany({
    where: { scopeType: "novel", scopeId: novelId, category: "角色立绘" },
    include: { versions: { where: { version: { gt: 0 } }, orderBy: { version: "desc" }, take: 1 } },
    orderBy: { title: "asc" },
  });

  // Character descriptions from novel-level character_arcs
  const { characterArcs } = await getNovelLevelData(novelId);
  const descMap = new Map<string, string>();
  for (const arc of characterArcs) {
    const name = String(arc.name ?? "");
    if (name) descMap.set(name, mergeCharacterDescription(arc));
  }

  return portraits.map((r) => ({
    name: r.title ?? r.key,
    description: descMap.get(r.title ?? "") ?? "",
    portraitUrl: r.versions[0]?.url ?? null,
  }));
}

/* ------------------------------------------------------------------ */
/*  Scene status                                                       */
/* ------------------------------------------------------------------ */

export interface SceneStatus {
  locationId: string;
  name: string;
  visualPrompt: string;
  parentLocationId: string | null;
  description: string;
  imageUrl: string | null;
}

export async function getSceneStatuses(novelId: string): Promise<SceneStatus[]> {
  // Scenes from KeyResource (created at upload)
  const scenes = await prisma.keyResource.findMany({
    where: { scopeType: "novel", scopeId: novelId, category: "场景" },
    include: { versions: { where: { version: { gt: 0 } }, orderBy: { version: "desc" }, take: 1 } },
    orderBy: { title: "asc" },
  });

  // Scene details from novel-level location_bible
  const { locationBible } = await getNovelLevelData(novelId);
  const sceneDetails = new Map<string, {
    visualPrompt: string;
    parentLocationId: string | null;
    description: string;
  }>();

  for (const loc of locationBible) {
    const locId = String(loc.id ?? "");
    const locName = String(loc.name ?? "");
    if (locName) {
      sceneDetails.set(locName, {
        visualPrompt: String(loc.visual_prompt ?? ""),
        parentLocationId: null,
        description: String(loc.description ?? ""),
      });
    }
    // Sub-locations
    const subs = loc.sub_locations as Array<Record<string, unknown>> | undefined;
    if (subs) {
      for (const sub of subs) {
        const subName = String(sub.name ?? "");
        if (subName) {
          sceneDetails.set(subName, {
            visualPrompt: String(sub.visual_prompt ?? ""),
            parentLocationId: locId || null,
            description: String(sub.description ?? ""),
          });
        }
      }
    }
  }

  return scenes.map((r) => {
    const detail = r.title ? sceneDetails.get(r.title) : undefined;
    return {
      locationId: r.key.replace(/^scene_/, ""),
      name: r.title ?? r.key,
      visualPrompt: detail?.visualPrompt ?? "",
      parentLocationId: detail?.parentLocationId ?? null,
      description: detail?.description ?? "",
      imageUrl: r.versions[0]?.url ?? null,
    };
  });
}

/* ------------------------------------------------------------------ */
/*  Generation progress                                                */
/* ------------------------------------------------------------------ */

export interface GenerationProgress {
  portraits: { done: number; total: number; missing: string[] };
  scenes: { done: number; total: number; missing: string[] };
}

export async function getNovelProgress(novelId: string): Promise<GenerationProgress> {
  // Pure KeyResource counts — no init_result scanning
  const portraitResources = await prisma.keyResource.findMany({
    where: { scopeType: "novel", scopeId: novelId, category: "角色立绘" },
    select: { title: true, currentVersion: true },
  });
  const sceneResources = await prisma.keyResource.findMany({
    where: { scopeType: "novel", scopeId: novelId, category: "场景" },
    select: { title: true, currentVersion: true },
  });

  const missingPortraits = portraitResources.filter((r) => r.currentVersion === 0).map((r) => r.title ?? "unknown");
  const missingScenes = sceneResources.filter((r) => r.currentVersion === 0).map((r) => r.title ?? "unknown");

  return {
    portraits: {
      done: portraitResources.length - missingPortraits.length,
      total: portraitResources.length,
      missing: missingPortraits,
    },
    scenes: {
      done: sceneResources.length - missingScenes.length,
      total: sceneResources.length,
      missing: missingScenes,
    },
  };
}

/* ------------------------------------------------------------------ */
/*  EP costume status                                                  */
/* ------------------------------------------------------------------ */

export interface CostumeStatus {
  characterName: string;
  outfit: string;
  costumeUrl: string | null;
}

/* ------------------------------------------------------------------ */
/*  Running executor tasks (for context provider)                      */
/* ------------------------------------------------------------------ */

export interface RunningExecutorTask {
  id: string;
  status: string;
  instructionPreview: string;
  createdAt: Date;
}

/**
 * Find running/pending executor tasks for sessions belonging to a novel.
 * Used by NovelContextProvider to inform the LLM about in-flight async work.
 */
export async function getRunningExecutorTasks(novelId: string): Promise<RunningExecutorTask[]> {
  const users = await prisma.user.findMany({
    where: { name: { startsWith: `video:${novelId}` } },
    select: { id: true },
  });
  if (users.length === 0) return [];

  const userIds = users.map((u) => u.id);
  const tasks = await prisma.task.findMany({
    where: {
      type: "executor",
      status: { in: ["pending", "running"] },
      session: { userId: { in: userIds } },
    },
    select: { id: true, status: true, input: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  return tasks.map((t) => {
    const input = t.input as Record<string, unknown> | null;
    const instruction = typeof input?.instruction === "string"
      ? (input.instruction as string).slice(0, 80)
      : "(unknown)";
    return {
      id: t.id,
      status: t.status,
      instructionPreview: instruction,
      createdAt: t.createdAt,
    };
  });
}

/**
 * Find running/pending executor tasks for an EP-level session.
 * Used by VideoContextProvider to inform the LLM about in-flight async work.
 */
export async function getRunningEpExecutorTasks(novelId: string, scriptKey: string): Promise<RunningExecutorTask[]> {
  const userName = `video:${novelId}:${scriptKey}`;
  const users = await prisma.user.findMany({
    where: { name: userName },
    select: { id: true },
  });
  if (users.length === 0) return [];

  const userIds = users.map((u) => u.id);
  const tasks = await prisma.task.findMany({
    where: {
      type: "executor",
      status: { in: ["pending", "running"] },
      session: { userId: { in: userIds } },
    },
    select: { id: true, status: true, input: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  return tasks.map((t) => {
    const input = t.input as Record<string, unknown> | null;
    const instruction = typeof input?.instruction === "string"
      ? (input.instruction as string).slice(0, 80)
      : "(unknown)";
    return {
      id: t.id,
      status: t.status,
      instructionPreview: instruction,
      createdAt: t.createdAt,
    };
  });
}

export async function getEpCostumeStatuses(scriptId: string): Promise<CostumeStatus[]> {
  // Costumes from KeyResource (created at upload)
  const costumes = await prisma.keyResource.findMany({
    where: { scopeType: "script", scopeId: scriptId, category: "换装" },
    include: { versions: { where: { version: { gt: 0 } }, orderBy: { version: "desc" }, take: 1 } },
    orderBy: { title: "asc" },
  });

  // Outfit descriptions from init_result
  const tScripts = await physical("novel_scripts");
  const { rows } = await bizPool.query(
    `SELECT init_result FROM "${tScripts}" WHERE id = $1 LIMIT 1`,
    [scriptId],
  );
  const ir = parseJsonb((rows[0] as { init_result: unknown } | undefined)?.init_result);
  const outfits = (ir?.character_outfits as Record<string, string>) ?? {};

  return costumes.map((r) => ({
    characterName: r.title ?? r.key,
    outfit: outfits[r.title ?? ""] ?? "",
    costumeUrl: r.versions[0]?.url ?? null,
  }));
}
