import { prisma } from "@/lib/db";
import type { Prisma as PrismaTypes } from "@/generated/prisma";
import { callFcGenerateImage } from "./fc-image-client";
import { generateVideo as seedanceGenerate } from "./seedance-client";
import type { SeedanceGenerateType } from "./seedance-client";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface VersionData {
  title?: string;
  url?: string;
  data?: PrismaTypes.InputJsonValue;
  prompt?: string;
  refUrls?: string[];
}

export interface KeyResourceRow {
  id: string;
  key: string;
  mediaType: string;
  currentVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface KeyResourceVersionRow {
  id: string;
  version: number;
  title: string | null;
  url: string | null;
  data: PrismaTypes.JsonValue;
  prompt: string | null;
  refUrls: string[];
  createdAt: Date;
}

export interface KeyResourceSummary {
  id: string;
  key: string;
  mediaType: string;
  currentVersion: number;
  /** Current version's snapshot */
  title: string | null;
  url: string | null;
  data: PrismaTypes.JsonValue;
  prompt: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface KeyResourceDetail {
  id: string;
  scopeType: string;
  scopeId: string;
  key: string;
  mediaType: string;
  currentVersion: number;
  title: string | null;
  url: string | null;
  data: PrismaTypes.JsonValue;
  prompt: string | null;
  versions: KeyResourceVersionRow[];
  createdAt: Date;
  updatedAt: Date;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

async function nextVersion(keyResourceId: string): Promise<number> {
  const last = await prisma.keyResourceVersion.findFirst({
    where: { keyResourceId },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  return (last?.version ?? 0) + 1;
}

function currentVersionData(
  versions: KeyResourceVersionRow[],
  currentVersion: number,
): { title: string | null; url: string | null; data: PrismaTypes.JsonValue; prompt: string | null } {
  const ver = versions.find((v) => v.version === currentVersion);
  return {
    title: ver?.title ?? null,
    url: ver?.url ?? null,
    data: ver?.data ?? null,
    prompt: ver?.prompt ?? null,
  };
}

/* ------------------------------------------------------------------ */
/*  upsertResource — universal entry point                             */
/* ------------------------------------------------------------------ */

/**
 * Upsert a key resource by (scopeType, scopeId, key).
 * Always creates a new version. Returns the identity row + new version number.
 */
export async function upsertResource(
  scopeType: string,
  scopeId: string,
  key: string,
  mediaType: string,
  versionData: VersionData,
): Promise<KeyResourceRow & { version: number }> {
  // 1. Upsert identity
  const resource = await prisma.keyResource.upsert({
    where: { scopeType_scopeId_key: { scopeType, scopeId, key } },
    create: { scopeType, scopeId, key, mediaType },
    update: {},
  });

  // 2. Create new version
  const ver = await nextVersion(resource.id);
  await prisma.keyResourceVersion.create({
    data: {
      keyResourceId: resource.id,
      version: ver,
      title: versionData.title ?? null,
      url: versionData.url ?? null,
      data: versionData.data ?? undefined,
      prompt: versionData.prompt ?? null,
      refUrls: versionData.refUrls ?? [],
    },
  });

  // 3. Bump currentVersion
  const updated = await prisma.keyResource.update({
    where: { id: resource.id },
    data: { currentVersion: ver },
  });

  return { ...updated, version: ver };
}

/* ------------------------------------------------------------------ */
/*  generateImage — FC image generation                                */
/* ------------------------------------------------------------------ */

export interface GenerateImageInput {
  scopeType: string;
  scopeId: string;
  key: string;
  prompt: string;
  refUrls?: string[];
  model?: string;
}

export interface GenerateImageResult {
  id: string;
  key: string;
  imageUrl: string;
  version: number;
}

export async function generateImage(
  input: GenerateImageInput,
): Promise<GenerateImageResult> {
  const { scopeType, scopeId, key, prompt, refUrls, model } = input;

  // 1. Upsert identity
  const resource = await prisma.keyResource.upsert({
    where: { scopeType_scopeId_key: { scopeType, scopeId, key } },
    create: { scopeType, scopeId, key, mediaType: "image" },
    update: {},
  });

  // 2. Call FC FIRST — no empty version row created until we have a result
  const imageUrl = await callFcGenerateImage(prompt, refUrls, model);

  // 3. Create version + bump currentVersion in one transaction (with retry for race)
  const maxRetries = 3;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const ver = await nextVersion(resource.id);
    try {
      await prisma.$transaction([
        prisma.keyResourceVersion.create({
          data: {
            keyResourceId: resource.id,
            version: ver,
            prompt,
            url: imageUrl,
            refUrls: refUrls ?? [],
          },
        }),
        prisma.keyResource.update({
          where: { id: resource.id },
          data: { currentVersion: ver },
        }),
      ]);
      return { id: resource.id, key, imageUrl, version: ver };
    } catch (err: unknown) {
      // Unique constraint on (keyResourceId, version) — retry with next version
      const msg = err instanceof Error ? err.message : "";
      if (attempt < maxRetries - 1 && msg.includes("Unique constraint")) continue;
      throw err;
    }
  }

  throw new Error(`Failed to persist version for ${key} after ${maxRetries} retries`);
}

/* ------------------------------------------------------------------ */
/*  regenerateImage — out-of-band (UI-driven) image regeneration        */
/* ------------------------------------------------------------------ */

export interface RegenerateResult {
  id: string;
  key: string;
  imageUrl: string;
  version: number;
  prompt: string;
}

export async function regenerateImage(
  id: string,
  promptOverride?: string,
): Promise<RegenerateResult> {
  const resource = await prisma.keyResource.findUniqueOrThrow({ where: { id } });

  // Find the current version row to derive prompt / refUrls
  const curVer = await prisma.keyResourceVersion.findUnique({
    where: {
      keyResourceId_version: { keyResourceId: resource.id, version: resource.currentVersion },
    },
  });
  if (!curVer) throw new Error(`Current version ${resource.currentVersion} not found`);

  const prompt = promptOverride ?? curVer.prompt ?? "";
  const refUrls = curVer.refUrls ?? [];

  const imageUrl = await callFcGenerateImage(prompt, refUrls.length > 0 ? refUrls : undefined);

  // Create a NEW version instead of overwriting the current one.
  // Previous versions remain as rollback targets.
  const ver = await nextVersion(resource.id);
  await prisma.$transaction([
    prisma.keyResourceVersion.create({
      data: {
        keyResourceId: resource.id,
        version: ver,
        prompt,
        url: imageUrl,
        refUrls: refUrls,
      },
    }),
    prisma.keyResource.update({
      where: { id: resource.id },
      data: { currentVersion: ver },
    }),
  ]);

  return { id: resource.id, key: resource.key, imageUrl, version: ver, prompt };
}

/** @deprecated Use regenerateImage instead */
export const regenerate = regenerateImage;

/* ------------------------------------------------------------------ */
/*  regenerateVideo — out-of-band (UI-driven) video regeneration        */
/* ------------------------------------------------------------------ */

export interface RegenerateVideoResult {
  id: string;
  key: string;
  videoUrl: string;
  version: number;
  prompt: string;
}

/**
 * Regenerate a video KeyResource using Seedance.
 * Reads generation metadata (generateType, imageUrls, videoUrls, duration)
 * from the current version's `data` JSONB field.
 */
export async function regenerateVideo(
  id: string,
  promptOverride?: string,
): Promise<RegenerateVideoResult> {
  const resource = await prisma.keyResource.findUniqueOrThrow({ where: { id } });

  const curVer = await prisma.keyResourceVersion.findUnique({
    where: {
      keyResourceId_version: { keyResourceId: resource.id, version: resource.currentVersion },
    },
  });
  if (!curVer) throw new Error(`Current version ${resource.currentVersion} not found`);

  const prompt = promptOverride ?? curVer.prompt ?? "";
  const refUrls = curVer.refUrls ?? [];

  // Restore Seedance call params from version metadata
  const meta = (curVer.data ?? {}) as Record<string, unknown> & PrismaTypes.InputJsonValue;
  const generateType = (meta.generateType as SeedanceGenerateType | undefined) ?? "text_to_video";
  const imageUrls = (meta.imageUrls as string[] | undefined) ?? [];
  const videoUrls = (meta.videoUrls as string[] | undefined) ?? [];
  const duration = (meta.duration as number | undefined) ?? undefined;

  const result = await seedanceGenerate({
    prompt,
    generateType,
    imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
    videoUrls: videoUrls.length > 0 ? videoUrls : undefined,
    duration,
  });

  const ver = await nextVersion(resource.id);
  await prisma.$transaction([
    prisma.keyResourceVersion.create({
      data: {
        keyResourceId: resource.id,
        version: ver,
        prompt,
        url: result.saveUrl,
        refUrls,
        data: meta,
      },
    }),
    prisma.keyResource.update({
      where: { id: resource.id },
      data: { currentVersion: ver },
    }),
  ]);

  return { id: resource.id, key: resource.key, videoUrl: result.saveUrl, version: ver, prompt };
}

/* ------------------------------------------------------------------ */
/*  rollback — move currentVersion pointer                             */
/* ------------------------------------------------------------------ */

export interface RollbackResult {
  id: string;
  key: string;
  version: number;
  prompt: string | null;
  url: string | null;
}

export async function rollback(
  id: string,
  targetVersion: number,
): Promise<RollbackResult> {
  const resource = await prisma.keyResource.findUniqueOrThrow({ where: { id } });

  const ver = await prisma.keyResourceVersion.findUnique({
    where: {
      keyResourceId_version: { keyResourceId: resource.id, version: targetVersion },
    },
  });
  if (!ver) {
    throw new Error(`Version ${targetVersion} not found for resource "${resource.key}"`);
  }

  await prisma.keyResource.update({
    where: { id: resource.id },
    data: { currentVersion: targetVersion },
  });

  return {
    id: resource.id,
    key: resource.key,
    version: targetVersion,
    prompt: ver.prompt,
    url: ver.url,
  };
}

/* ------------------------------------------------------------------ */
/*  updatePrompt — create new version reusing current url              */
/* ------------------------------------------------------------------ */

export interface UpdatePromptResult {
  id: string;
  key: string;
  version: number;
  prompt: string;
  url: string | null;
}

export async function updatePrompt(
  id: string,
  newPrompt: string,
): Promise<UpdatePromptResult> {
  const resource = await prisma.keyResource.findUniqueOrThrow({ where: { id } });

  const curVer = resource.currentVersion > 0
    ? await prisma.keyResourceVersion.findUnique({
        where: { keyResourceId_version: { keyResourceId: resource.id, version: resource.currentVersion } },
      })
    : null;

  const ver = await nextVersion(resource.id);
  await prisma.keyResourceVersion.create({
    data: {
      keyResourceId: resource.id,
      version: ver,
      prompt: newPrompt,
      url: curVer?.url ?? null,
      refUrls: curVer?.refUrls ?? [],
    },
  });

  await prisma.keyResource.update({
    where: { id: resource.id },
    data: { currentVersion: ver },
  });

  return {
    id: resource.id,
    key: resource.key,
    version: ver,
    prompt: newPrompt,
    url: curVer?.url ?? null,
  };
}

export interface UpdateDataResult {
  id: string;
  key: string;
  version: number;
  data: PrismaTypes.InputJsonValue;
}

export async function updateData(
  id: string,
  newData: PrismaTypes.InputJsonValue,
): Promise<UpdateDataResult> {
  const resource = await prisma.keyResource.findUniqueOrThrow({ where: { id } });

  const curVer = resource.currentVersion > 0
    ? await prisma.keyResourceVersion.findUnique({
        where: { keyResourceId_version: { keyResourceId: resource.id, version: resource.currentVersion } },
      })
    : null;

  const ver = await nextVersion(resource.id);
  await prisma.keyResourceVersion.create({
    data: {
      keyResourceId: resource.id,
      version: ver,
      title: curVer?.title ?? null,
      url: curVer?.url ?? null,
      data: newData,
      prompt: curVer?.prompt ?? null,
      refUrls: curVer?.refUrls ?? [],
    },
  });

  await prisma.keyResource.update({
    where: { id: resource.id },
    data: { currentVersion: ver },
  });

  return {
    id: resource.id,
    key: resource.key,
    version: ver,
    data: newData,
  };
}

/* ------------------------------------------------------------------ */
/*  deleteVersion — remove a single version record                     */
/* ------------------------------------------------------------------ */

export interface DeleteVersionResult {
  id: string;
  key: string;
  deletedVersion: number;
  currentVersion: number;
}

/**
 * Delete a specific version record from a key resource.
 * - The last remaining version cannot be deleted.
 * - If the deleted version is the current version, the pointer moves to the
 *   highest remaining version.
 * - Version numbers of other records are NOT changed.
 */
export async function deleteVersion(
  id: string,
  targetVersion: number,
): Promise<DeleteVersionResult> {
  const resource = await prisma.keyResource.findUniqueOrThrow({ where: { id } });

  // Count existing versions
  const count = await prisma.keyResourceVersion.count({
    where: { keyResourceId: resource.id },
  });
  if (count <= 1) {
    throw new Error("Cannot delete the last remaining version");
  }

  // Ensure the target version exists
  const ver = await prisma.keyResourceVersion.findUnique({
    where: { keyResourceId_version: { keyResourceId: resource.id, version: targetVersion } },
  });
  if (!ver) {
    throw new Error(`Version ${targetVersion} not found for resource "${resource.key}"`);
  }

  // Delete the version row
  await prisma.keyResourceVersion.delete({ where: { id: ver.id } });

  // If we just deleted the current version, move pointer to highest remaining
  let newCurrent = resource.currentVersion;
  if (resource.currentVersion === targetVersion) {
    const highest = await prisma.keyResourceVersion.findFirst({
      where: { keyResourceId: resource.id },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    newCurrent = highest?.version ?? 0;
    await prisma.keyResource.update({
      where: { id: resource.id },
      data: { currentVersion: newCurrent },
    });
  }

  return {
    id: resource.id,
    key: resource.key,
    deletedVersion: targetVersion,
    currentVersion: newCurrent,
  };
}

/* ------------------------------------------------------------------ */
/*  Read operations                                                    */
/* ------------------------------------------------------------------ */

export async function getById(id: string): Promise<KeyResourceDetail | null> {
  const resource = await prisma.keyResource.findUnique({
    where: { id },
    include: { versions: { orderBy: { version: "asc" } } },
  });
  if (!resource) return null;

  const cur = currentVersionData(resource.versions, resource.currentVersion);

  return {
    id: resource.id,
    scopeType: resource.scopeType,
    scopeId: resource.scopeId,
    key: resource.key,
    mediaType: resource.mediaType,
    currentVersion: resource.currentVersion,
    ...cur,
    versions: resource.versions.map((v) => ({
      id: v.id,
      version: v.version,
      title: v.title,
      url: v.url,
      data: v.data,
      prompt: v.prompt,
      refUrls: v.refUrls,
      createdAt: v.createdAt,
    })),
    createdAt: resource.createdAt,
    updatedAt: resource.updatedAt,
  };
}

export async function listByScope(
  scopeType: string,
  scopeId: string,
): Promise<KeyResourceSummary[]> {
  return listResources({ scopeType, scopeId });
}

export async function listByScopeAndMediaType(
  scopeType: string,
  scopeId: string,
  mediaType: string,
): Promise<KeyResourceSummary[]> {
  return listResources({ scopeType, scopeId, mediaType });
}

async function listResources(
  filter: { scopeType?: string; scopeId?: string; mediaType?: string },
): Promise<KeyResourceSummary[]> {
  const where: PrismaTypes.KeyResourceWhereInput = {};
  if (filter.scopeType) where.scopeType = filter.scopeType;
  if (filter.scopeId) where.scopeId = filter.scopeId;
  if (filter.mediaType) where.mediaType = filter.mediaType;

  const resources = await prisma.keyResource.findMany({
    where,
    include: { versions: { orderBy: { version: "asc" } } },
    orderBy: { createdAt: "asc" },
  });

  return resources.map((r) => {
    const cur = currentVersionData(r.versions, r.currentVersion);
    return {
      id: r.id,
      key: r.key,
      mediaType: r.mediaType,
      currentVersion: r.currentVersion,
      ...cur,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  });
}

/**
 * List key resources for a scope — flat view for UI.
 * Returns one entry per resource with current version data resolved.
 */
export async function listForScope(
  scopeType: string,
  scopeId: string,
): Promise<Array<{
  id: string;
  key: string;
  mediaType: string;
  currentVersion: number;
  title: string | null;
  url: string | null;
  data: PrismaTypes.JsonValue;
}>> {
  const resources = await prisma.keyResource.findMany({
    where: { scopeType, scopeId },
    include: { versions: { orderBy: { version: "asc" } } },
    orderBy: { createdAt: "asc" },
  });

  return resources.map((r) => {
    const cur = currentVersionData(r.versions, r.currentVersion);
    return {
      id: r.id,
      key: r.key,
      mediaType: r.mediaType,
      currentVersion: r.currentVersion,
      title: cur.title,
      url: cur.url,
      data: cur.data,
    };
  });
}

/* ------------------------------------------------------------------ */
/*  Delete                                                             */
/* ------------------------------------------------------------------ */

export async function deleteResource(id: string): Promise<void> {
  await prisma.keyResource.delete({ where: { id } });
}
