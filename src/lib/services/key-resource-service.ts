import { prisma } from "@/lib/db";
import type { KeyResource, Prisma as PrismaTypes } from "@/generated/prisma";
import { compileTemplate } from "@/lib/mcp/static/langfuse-helpers";
import { callFcGenerateImage } from "./fc-image-client";
import {
  compressImageUrlLossless,
  type ImageCompressionResult,
} from "./image-compression-service";
import { generateFilename, uploadBuffer } from "./oss-service";

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
  category: string | null;
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

interface DerivedPromptData {
  title: string | null;
  prompt: string | null;
  refUrls: string[];
}

interface SceneLookupResult {
  name: string;
  visualPrompt: string | null;
  parentName: string | null;
  parentVisualPrompt: string | null;
  siblingSlots: string[];
}

function stringField(value: unknown, field: string): string | null {
  if (!isPlainJsonObject(value)) return null;
  const fieldValue = value[field];
  return typeof fieldValue === "string" && fieldValue.trim() ? fieldValue : null;
}

function arrayField(value: unknown, field: string): unknown[] {
  if (!isPlainJsonObject(value)) return [];
  const fieldValue = value[field];
  return Array.isArray(fieldValue) ? fieldValue : [];
}

async function getStylePrompt(name: string): Promise<{ prompt: string; refUrls: string[] } | null> {
  const style = await prisma.stylePreset.findUnique({ where: { name } });
  if (!style) return null;
  return {
    prompt: style.prompt,
    refUrls: style.referenceImageUrl ? [style.referenceImageUrl] : [],
  };
}

async function derivePortraitPrompt(resource: KeyResource): Promise<DerivedPromptData | null> {
  const characterName = resource.title?.trim();
  if (!characterName || resource.scopeType !== "novel") return null;

  const novel = await prisma.novel.findUnique({
    where: { id: resource.scopeId },
    select: { characterArcs: true },
  });
  const arc = Array.isArray(novel?.characterArcs)
    ? novel.characterArcs.find((item) => stringField(item, "name") === characterName)
    : undefined;
  const appearance = stringField(arc, "appearance");
  const style = await getStylePrompt("portrait-style");
  if (!appearance || !style) return null;

  return {
    title: characterName,
    prompt: compileTemplate(style.prompt, { demographics: appearance }),
    refUrls: style.refUrls,
  };
}

function findScene(locationBible: unknown, sceneName: string): SceneLookupResult | null {
  const locations = Array.isArray(locationBible) ? locationBible : [];
  for (const location of locations) {
    const parentName = stringField(location, "name");
    const parentVisualPrompt = stringField(location, "visual_prompt");
    const subLocations = arrayField(location, "sub_locations");
    const siblingSlots = subLocations
      .filter((subLocation) => stringField(subLocation, "id") !== stringField(location, "id"))
      .map((subLocation) => {
        const name = stringField(subLocation, "name");
        const visualPrompt = stringField(subLocation, "visual_prompt");
        return name && visualPrompt ? `【格】${name}：${visualPrompt}` : null;
      })
      .filter((slot): slot is string => slot != null);

    if (parentName === sceneName) {
      return {
        name: parentName,
        visualPrompt: parentVisualPrompt,
        parentName: null,
        parentVisualPrompt,
        siblingSlots,
      };
    }

    for (const subLocation of subLocations) {
      const subName = stringField(subLocation, "name");
      if (subName === sceneName) {
        return {
          name: subName,
          visualPrompt: stringField(subLocation, "visual_prompt"),
          parentName,
          parentVisualPrompt,
          siblingSlots,
        };
      }
    }
  }
  return null;
}

async function deriveScenePrompt(resource: KeyResource): Promise<DerivedPromptData | null> {
  if (resource.scopeType !== "novel") return null;
  const rawTitle = resource.title?.trim();
  if (!rawTitle) return null;
  const isGrid = resource.key.endsWith("_grid") || rawTitle.endsWith(" (grid)");
  const sceneName = rawTitle.endsWith(" (grid)") ? rawTitle.slice(0, -" (grid)".length) : rawTitle;

  const novel = await prisma.novel.findUnique({
    where: { id: resource.scopeId },
    select: { locationBible: true },
  });
  const scene = findScene(novel?.locationBible, sceneName);
  if (!scene) return null;

  if (isGrid) {
    const style = await getStylePrompt("location_grid_style");
    if (!style || !scene.visualPrompt) return null;
    const slots = [`【格 1】${scene.name}：${scene.visualPrompt}`, ...scene.siblingSlots];
    return {
      title: rawTitle,
      prompt: compileTemplate(style.prompt, {
        name: scene.name,
        gridSize: String(slots.length),
        gridSlots: slots.join("\n"),
      }),
      refUrls: style.refUrls,
    };
  }

  if (scene.parentName) {
    const style = await getStylePrompt("sub_location_style");
    if (!style) return null;
    return {
      title: rawTitle,
      prompt: compileTemplate(style.prompt, { name: scene.name, sceneName: scene.name }),
      refUrls: style.refUrls,
    };
  }

  const style = await getStylePrompt("location_style");
  if (!style || !scene.visualPrompt) return null;
  return {
    title: rawTitle,
    prompt: compileTemplate(style.prompt, { name: scene.name, scenePrompt: scene.visualPrompt }),
    refUrls: style.refUrls,
  };
}

async function deriveCostumePrompt(resource: KeyResource): Promise<DerivedPromptData | null> {
  const characterName = resource.title?.trim();
  if (!characterName || resource.scopeType !== "script") return null;
  const script = await prisma.novelScript.findUnique({
    where: { id: resource.scopeId },
    select: { novelId: true, initResult: true, costumes: true },
  });
  if (!script) return null;

  const initResult = isPlainJsonObject(script.initResult) ? script.initResult : null;
  const outfits = isPlainJsonObject(initResult?.character_outfits)
    ? initResult.character_outfits
    : isPlainJsonObject(script.costumes)
      ? script.costumes
      : null;
  const outfit = outfits ? outfits[characterName] : null;
  const style = await getStylePrompt("update_portrait_style");
  if (typeof outfit !== "string" || !outfit.trim() || !style) return null;

  const portraitKey = `char_${characterName.toLowerCase().replace(/\s+/g, "_")}_portrait`;
  const portrait = await prisma.keyResource.findFirst({
    where: { scopeType: "novel", scopeId: script.novelId, key: portraitKey, currentVersion: { gt: 0 } },
    include: { versions: { orderBy: { version: "desc" }, take: 1 } },
  });
  const portraitUrl = portrait?.versions[0]?.url;

  return {
    title: characterName,
    prompt: compileTemplate(style.prompt, { appearance_desc: outfit }),
    refUrls: portraitUrl ? [...style.refUrls, portraitUrl] : style.refUrls,
  };
}

async function derivePromptData(resource: KeyResource): Promise<DerivedPromptData> {
  const derived = resource.category === "角色立绘"
    ? await derivePortraitPrompt(resource)
    : resource.category === "场景"
      ? await deriveScenePrompt(resource)
      : resource.category === "换装"
        ? await deriveCostumePrompt(resource)
        : null;

  return derived ?? { title: resource.title, prompt: null, refUrls: [] };
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

export interface UploadImageVersionInput {
  id: string;
  buffer: Buffer;
  originalName: string;
  filename?: string;
}

export interface UploadImageVersionResult {
  id: string;
  key: string;
  imageUrl: string;
  compressedImageUrl: string;
  version: number;
}

export async function uploadImageVersion(
  input: UploadImageVersionInput,
): Promise<UploadImageVersionResult> {
  const resource = await prisma.keyResource.findUniqueOrThrow({ where: { id: input.id } });
  if (resource.mediaType !== "image") {
    throw new Error("Only image key resources can accept image uploads");
  }

  const curVer = resource.currentVersion > 0
    ? await prisma.keyResourceVersion.findUnique({
        where: {
          keyResourceId_version: { keyResourceId: resource.id, version: resource.currentVersion },
        },
      })
    : null;
  const derived = curVer ? null : await derivePromptData(resource);
  const prompt = curVer?.prompt ?? derived?.prompt ?? null;
  const refUrls = curVer?.refUrls ?? derived?.refUrls ?? [];
  const title = curVer?.title ?? derived?.title ?? resource.title ?? null;

  const filename = input.filename ?? generateFilename(input.originalName, resource.key);
  const imageUrl = await uploadBuffer(input.buffer, filename, "key-resources");
  const compression = await compressGeneratedImageData(imageUrl, resource.key);

  const ver = await nextVersion(resource.id);
  await prisma.$transaction([
    prisma.keyResourceVersion.create({
      data: {
        keyResourceId: resource.id,
        version: ver,
        title,
        prompt,
        url: imageUrl,
        data: compression.data,
        refUrls,
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
  };
}

export async function regenerate(
  id: string,
  promptOverride?: string,
): Promise<RegenerateResult> {
  const resource = await prisma.keyResource.findUniqueOrThrow({ where: { id } });

  // Find the current version row to derive prompt / refUrls
  const curVer = resource.currentVersion > 0
    ? await prisma.keyResourceVersion.findUnique({
        where: {
          keyResourceId_version: { keyResourceId: resource.id, version: resource.currentVersion },
        },
      })
    : null;
  const derived = curVer ? null : await derivePromptData(resource);

  const prompt = promptOverride ?? curVer?.prompt ?? derived?.prompt ?? "";
  if (!prompt.trim()) {
    throw new Error("Prompt is required to generate an image");
  }
  const refUrls = curVer?.refUrls ?? derived?.refUrls ?? [];

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
  const derived = cur.prompt ? null : await derivePromptData(resource);

  return {
    id: resource.id,
    scopeType: resource.scopeType,
    scopeId: resource.scopeId,
    key: resource.key,
    mediaType: resource.mediaType,
    category: resource.category,
    currentVersion: resource.currentVersion,
    title: cur.title ?? derived?.title ?? resource.title,
    url: cur.url,
    data: cur.data,
    prompt: cur.prompt ?? derived?.prompt ?? null,
    refUrls: cur.refUrls.length > 0 ? cur.refUrls : derived?.refUrls ?? [],
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
