import { prisma } from "@/lib/db";
import type { Prisma as PrismaTypes } from "@/generated/prisma";
import { callFcGenerateImage } from "./fc-image-client";
import {
  compressImageUrlLossless,
  type ImageCompressionResult,
} from "./image-compression-service";

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
  refUrls: string[];
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
  refUrls: string[];
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
): {
  title: string | null;
  url: string | null;
  data: PrismaTypes.JsonValue;
  prompt: string | null;
  refUrls: string[];
} {
  const ver = versions.find((v) => v.version === currentVersion);
  return {
    title: ver?.title ?? null,
    url: ver?.url ?? null,
    data: ver?.data ?? null,
    prompt: ver?.prompt ?? null,
    refUrls: ver?.refUrls ?? [],
  };
}

function isPlainJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneJson(value: unknown): unknown {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function mergePromptFieldsIntoData(
  data: PrismaTypes.InputJsonValue | PrismaTypes.JsonValue | null | undefined,
  prompt?: string | null,
  refUrls?: string[] | null,
): PrismaTypes.InputJsonValue | undefined {
  const hasPrompt = typeof prompt === "string";
  const hasRefUrls = Array.isArray(refUrls);
  if (data == null && !hasPrompt && !hasRefUrls) return undefined;

  const cloned = data == null ? {} : cloneJson(data);
  if (!isPlainJsonObject(cloned)) {
    return cloned as PrismaTypes.InputJsonValue;
  }

  const next: Record<string, unknown> = { ...cloned };
  if (hasPrompt) next.prompt = prompt;
  if (hasRefUrls) next.refUrls = refUrls;
  return next as PrismaTypes.InputJsonValue;
}

function promptFromData(data: PrismaTypes.InputJsonValue | PrismaTypes.JsonValue): string | null {
  const cloned = cloneJson(data);
  return isPlainJsonObject(cloned) && typeof cloned.prompt === "string"
    ? cloned.prompt
    : null;
}

function refUrlsFromData(data: PrismaTypes.InputJsonValue | PrismaTypes.JsonValue): string[] | null {
  const cloned = cloneJson(data);
  if (!isPlainJsonObject(cloned) || !Array.isArray(cloned.refUrls)) return null;
  return cloned.refUrls.every((url): url is string => typeof url === "string")
    ? cloned.refUrls
    : null;
}

function imageCompressionToJson(
  compression: ImageCompressionResult,
): PrismaTypes.InputJsonValue {
  return {
    originalUrl: compression.originalUrl,
    compressedUrl: compression.compressedUrl,
    originalBytes: compression.originalBytes,
    compressedBytes: compression.compressedBytes,
    format: compression.format,
    uploaded: compression.uploaded,
    ...(compression.note ? { note: compression.note } : {}),
  } as PrismaTypes.InputJsonValue;
}

async function compressGeneratedImageData(
  imageUrl: string,
  key: string,
): Promise<{ data: PrismaTypes.InputJsonValue; compressedUrl: string }> {
  try {
    const compression = await compressImageUrlLossless(imageUrl, key);
    return {
      data: { imageCompression: imageCompressionToJson(compression) } as PrismaTypes.InputJsonValue,
      compressedUrl: compression.compressedUrl,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      data: {
        imageCompression: {
          originalUrl: imageUrl,
          compressedUrl: imageUrl,
          originalBytes: 0,
          compressedBytes: 0,
          format: "unknown",
          uploaded: false,
          note: `lossless compression failed; using original URL: ${message}`,
        },
      } as PrismaTypes.InputJsonValue,
      compressedUrl: imageUrl,
    };
  }
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
  const data = mergePromptFieldsIntoData(
    versionData.data,
    versionData.prompt,
    versionData.refUrls,
  );
  await prisma.keyResourceVersion.create({
    data: {
      keyResourceId: resource.id,
      version: ver,
      title: versionData.title ?? null,
      url: versionData.url ?? null,
      data,
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
  compressedImageUrl: string;
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

  // 2. Create version (url = null initially)
  const ver = await nextVersion(resource.id);
  const versionRow = await prisma.keyResourceVersion.create({
    data: {
      keyResourceId: resource.id,
      version: ver,
      prompt,
      refUrls: refUrls ?? [],
    },
  });

  // 3. Call FC
  const imageUrl = await callFcGenerateImage(prompt, refUrls, model);
  const compression = await compressGeneratedImageData(imageUrl, key);

  // 4. Update version url + bump currentVersion
  await prisma.$transaction([
    prisma.keyResourceVersion.update({
      where: { id: versionRow.id },
      data: { url: imageUrl, data: compression.data },
    }),
    prisma.keyResource.update({
      where: { id: resource.id },
      data: { currentVersion: ver },
    }),
  ]);

  return { id: resource.id, key, imageUrl, compressedImageUrl: compression.compressedUrl, version: ver };
}

/* ------------------------------------------------------------------ */
/*  regenerate — out-of-band (UI-driven) regeneration                  */
/* ------------------------------------------------------------------ */

export interface RegenerateResult {
  id: string;
  key: string;
  imageUrl: string;
  compressedImageUrl: string;
  version: number;
  prompt: string;
}

export async function regenerate(
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
  const compression = await compressGeneratedImageData(imageUrl, resource.key);

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
        data: compression.data,
        refUrls: refUrls,
      },
    }),
    prisma.keyResource.update({
      where: { id: resource.id },
      data: { currentVersion: ver },
    }),
  ]);

  return {
    id: resource.id,
    key: resource.key,
    imageUrl,
    compressedImageUrl: compression.compressedUrl,
    version: ver,
    prompt,
  };
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
  const nextData = mergePromptFieldsIntoData(
    curVer?.data ?? null,
    newPrompt,
    curVer?.refUrls ?? [],
  );
  await prisma.keyResourceVersion.create({
    data: {
      keyResourceId: resource.id,
      version: ver,
      title: curVer?.title ?? null,
      prompt: newPrompt,
      url: curVer?.url ?? null,
      data: nextData,
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
        where: {
          keyResourceId_version: {
            keyResourceId: resource.id,
            version: resource.currentVersion,
          },
        },
      })
    : null;

  const ver = await nextVersion(resource.id);
  const prompt = promptFromData(newData) ?? curVer?.prompt ?? null;
  const refUrls = refUrlsFromData(newData) ?? curVer?.refUrls ?? [];
  const data = mergePromptFieldsIntoData(newData, prompt, refUrls) ?? newData;
  await prisma.keyResourceVersion.create({
    data: {
      keyResourceId: resource.id,
      version: ver,
      title: curVer?.title ?? null,
      url: curVer?.url ?? null,
      data,
      prompt,
      refUrls,
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
  prompt: string | null;
  refUrls: string[];
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
      prompt: cur.prompt,
      refUrls: cur.refUrls,
    };
  });
}

/* ------------------------------------------------------------------ */
/*  Delete                                                             */
/* ------------------------------------------------------------------ */

export async function deleteResource(id: string): Promise<void> {
  await prisma.keyResource.delete({ where: { id } });
}
