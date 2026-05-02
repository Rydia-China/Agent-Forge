/**
 * Video Asset Generation Service - Image and video generation
 * 
 * This service handles:
 * - Portrait generation (character images)
 * - Scene generation (location images, grids, HD)
 * - Costume generation (character outfits)
 * - Video prompt execution
 */

import { z } from "zod";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma";
import type {
  StylePreset,
  AnalyzedLocation,
  GenerateAndPersistImageInput,
  GenerateAndPersistImageResult,
  ExecuteVideoPromptResult,
} from "@/lib/video/asset-generation-types";
import * as keyResourceService from "./key-resource-service";
import {
  callFcGenerateVideo,
  callFcCropVideo,
  callFcExtractLastFrame,
} from "./fc-video-client";
import {
  callFcHappyHorseGenerate,
  type MediaItem,
} from "./fc-happyhorse-client";
import {
  compressedUrlFromResourceData,
  compressImageUrlLosslessBestEffort,
  type ImageCompressionResult,
} from "./image-compression-service";
import { compileTemplate } from "@/lib/mcp/static/langfuse-helpers";
import { getNovelLevelData } from "./novel-service";

/* ------------------------------------------------------------------ */
/*  Style resolution                                                   */
/* ------------------------------------------------------------------ */
export async function resolveStyle(styleName: string): Promise<StylePreset> {
  const preset = await prisma.stylePreset.findUnique({ where: { name: styleName } });
  if (!preset) throw new Error(`Style preset not found: ${styleName}`);
  return { stylePrompt: preset.prompt, styleRefUrl: preset.referenceImageUrl };
}

/* ------------------------------------------------------------------ */
/*  Scene structure analysis                                           */
/* ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function imageCompressionResultToJson(
  compression: ImageCompressionResult,
): Prisma.InputJsonObject {
  return {
    originalUrl: compression.originalUrl,
    compressedUrl: compression.compressedUrl,
    originalBytes: compression.originalBytes,
    compressedBytes: compression.compressedBytes,
    format: compression.format,
    uploaded: compression.uploaded,
    ...(compression.note ? { note: compression.note } : {}),
  };
}

export interface AnalyzedSubLocation {
  id: string;
  name: string;
  visualPrompt: string;
}

export function analyzeLocations(locationBible: Array<Record<string, unknown>>): AnalyzedLocation[] {
  return locationBible
    .map((location): AnalyzedLocation | null => {
      const name = typeof location.name === "string" ? location.name : null;
      if (!name) return null;

      const id = typeof location.id === "string" ? location.id : name;
      const visualPrompt = typeof location.visual_prompt === "string" ? location.visual_prompt : "";
      const rawSubs = Array.isArray(location.sub_locations) ? location.sub_locations : [];
      const realSubs = rawSubs
        .filter(isRecord)
        .filter((sub) => sub.id !== id)
        .map((sub): AnalyzedSubLocation | null => {
          const subName = typeof sub.name === "string" ? sub.name : null;
          if (!subName) return null;
          return {
            id: typeof sub.id === "string" ? sub.id : subName,
            name: subName,
            visualPrompt: typeof sub.visual_prompt === "string" ? sub.visual_prompt : "",
          };
        })
        .filter((sub): sub is AnalyzedSubLocation => sub !== null);

      return {
        id,
        name,
        visualPrompt,
        mode: realSubs.length >= 2 ? "grid" : "single",
        realSubs,
        gridSize: realSubs.length + 1,
      };
    })
    .filter((location): location is AnalyzedLocation => location !== null);
}

type SceneGenerationMode = "single" | "grid" | "hd";

interface ResolvedSceneIdentifier {
  requestedName: string;
  sceneName: string;
  placeholderMode: SceneGenerationMode | null;
}

function stripGridTitleSuffix(title: string): string {
  return title.endsWith(" (grid)") ? title.slice(0, -" (grid)".length) : title;
}

function keyNameAlias(key: string): string | null {
  return key.startsWith("scene_") ? key.slice("scene_".length) : null;
}

function addSceneAlias(
  aliases: Map<string, ResolvedSceneIdentifier>,
  alias: string | null,
  value: ResolvedSceneIdentifier,
): void {
  const normalized = alias?.trim();
  if (!normalized || aliases.has(normalized)) return;
  aliases.set(normalized, value);
}

async function resolveSceneIdentifiers(
  novelId: string,
  requestedNames: string[],
): Promise<ResolvedSceneIdentifier[]> {
  const resources = await prisma.keyResource.findMany({
    where: {
      scopeType: "novel",
      scopeId: novelId,
      category: "场景",
    },
    select: { key: true, title: true },
  });

  const aliases = new Map<string, ResolvedSceneIdentifier>();
  for (const resource of resources) {
    const title = resource.title?.trim();
    if (!title) continue;

    const isGrid = resource.key.endsWith("_grid") || title.endsWith(" (grid)");
    const sceneName = stripGridTitleSuffix(title);
    const value: ResolvedSceneIdentifier = {
      requestedName: sceneName,
      sceneName,
      placeholderMode: isGrid ? "grid" : "single",
    };

    addSceneAlias(aliases, resource.key, value);
    addSceneAlias(aliases, keyNameAlias(resource.key), value);
    addSceneAlias(aliases, title, value);
  }

  return requestedNames.map((requestedName) => {
    const trimmed = requestedName.trim();
    const fromResource = aliases.get(trimmed);
    if (fromResource) return { ...fromResource, requestedName: trimmed };

    if (trimmed.startsWith("scene_")) {
      const withoutPrefix = trimmed.slice("scene_".length);
      if (withoutPrefix.endsWith("_grid")) {
        return {
          requestedName: trimmed,
          sceneName: withoutPrefix.slice(0, -"_grid".length).replace(/_/g, " "),
          placeholderMode: "grid",
        };
      }
      return {
        requestedName: trimmed,
        sceneName: withoutPrefix.replace(/_/g, " "),
        placeholderMode: null,
      };
    }

    if (trimmed.endsWith("_grid")) {
      return {
        requestedName: trimmed,
        sceneName: trimmed.slice(0, -"_grid".length).replace(/_/g, " "),
        placeholderMode: "grid",
      };
    }

    return {
      requestedName: trimmed,
      sceneName: trimmed,
      placeholderMode: null,
    };
  });
}

/* ------------------------------------------------------------------ */
/*  KeyResource metadata update                                        */
/* ------------------------------------------------------------------ */

export async function setKeyResourceMetadata(
  id: string,
  category: string,
  title: string,
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "KeyResource"
    SET category = ${category},
        title = ${title},
        "updatedAt" = NOW()
    WHERE id = ${id}
  `;
}

/* ------------------------------------------------------------------ */
/*  Image generation with persistence                                  */
/* ------------------------------------------------------------------ */

export async function generateAndPersistImage(
  input: GenerateAndPersistImageInput,
): Promise<GenerateAndPersistImageResult> {
  const gen = await keyResourceService.generateImage({
    scopeType: input.scopeType,
    scopeId: input.scopeId,
    key: input.key,
    prompt: input.prompt,
    refUrls: input.refUrls,
    model: input.model,
  });

  await setKeyResourceMetadata(gen.id, input.category, input.title);

  return {
    status: "ok",
    key: input.key,
    keyResourceId: gen.id,
    imageUrl: gen.imageUrl,
    compressedImageUrl: gen.compressedImageUrl,
    version: gen.version,
  };
}

/* ------------------------------------------------------------------ */
/*  Portrait generation                                                */
/* ------------------------------------------------------------------ */

export const GeneratePortraitParams = z.object({
  novelId: z.string().min(1),
  characterName: z.string().min(1),
  prompt: z.string().optional(),
  referenceUrls: z.array(z.string().url()).optional(),
  styleName: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
});

export type GeneratePortraitInput = z.infer<typeof GeneratePortraitParams>;

export async function generatePortrait(
  input: GeneratePortraitInput,
): Promise<GenerateAndPersistImageResult> {
  let prompt = input.prompt;
  let styleRefUrl: string | null = null;

  if (!prompt) {
    const { characterArcs } = await getNovelLevelData(input.novelId);
    const arc = characterArcs.find((a) => String(a.name) === input.characterName);
    if (!arc) throw new Error(`No character arc found for "${input.characterName}"`);

    const style = await resolveStyle(input.styleName ?? "portrait-style");
    styleRefUrl = style.styleRefUrl;

    const demographics = arc.appearance ? String(arc.appearance) : "";
    if (!demographics) throw new Error(`Character arc for "${input.characterName}" has no appearance`);

    prompt = compileTemplate(style.stylePrompt, { demographics });
  }

  const finalRefUrls = styleRefUrl
    ? [styleRefUrl, ...(input.referenceUrls ?? [])]
    : input.referenceUrls;

  const key = `char_${input.characterName.toLowerCase().replace(/\s+/g, "_")}_portrait`;
  return generateAndPersistImage({
    scopeType: "novel",
    scopeId: input.novelId,
    key,
    category: "角色立绘",
    prompt,
    title: input.characterName,
    refUrls: finalRefUrls,
    model: input.model,
  });
}

/* ------------------------------------------------------------------ */
/*  Update portrait                                                    */
/* ------------------------------------------------------------------ */

export async function updatePortrait(
  input: GeneratePortraitInput,
): Promise<GenerateAndPersistImageResult> {
  let prompt = input.prompt;
  let styleRefUrl: string | null = null;

  if (!prompt) {
    const { characterArcs } = await getNovelLevelData(input.novelId);
    const arc = characterArcs.find((a) => String(a.name) === input.characterName);
    if (!arc) throw new Error(`No character arc found for "${input.characterName}"`);

    const style = await resolveStyle(input.styleName ?? "update_portrait_style");
    styleRefUrl = style.styleRefUrl;

    const appearance_desc = arc.appearance ? String(arc.appearance) : "";
    if (!appearance_desc) throw new Error(`Character arc for "${input.characterName}" has no appearance`);

    prompt = compileTemplate(style.stylePrompt, { appearance_desc });
  }

  const finalRefUrls = styleRefUrl
    ? [styleRefUrl, ...(input.referenceUrls ?? [])]
    : input.referenceUrls;

  const key = `char_${input.characterName.toLowerCase().replace(/\s+/g, "_")}_portrait`;
  return generateAndPersistImage({
    scopeType: "novel",
    scopeId: input.novelId,
    key,
    category: "角色立绘",
    prompt,
    title: input.characterName,
    refUrls: finalRefUrls,
    model: input.model,
  });
}

/* ------------------------------------------------------------------ */
/*  Scene generation                                                   */
/* ------------------------------------------------------------------ */

export const GenerateSceneParams = z.object({
  novelId: z.string().min(1),
  sceneName: z.string().min(1),
  referenceUrls: z.array(z.string().url()).optional(),
  model: z.string().min(1).optional(),
  mode: z.enum(["single", "grid", "hd"]).default("single"),
});

export type GenerateSceneInput = z.infer<typeof GenerateSceneParams>;

export async function generateScene(
  input: GenerateSceneInput,
): Promise<GenerateAndPersistImageResult> {
  const [resolvedScene] = await resolveSceneIdentifiers(input.novelId, [input.sceneName]);
  const sceneName = resolvedScene?.sceneName ?? input.sceneName;

  if (input.mode === "single") {
    const { locationBible } = await getNovelLevelData(input.novelId);
    const analyzed = analyzeLocations(locationBible);
    const gridParent = analyzed.find((loc) => loc.mode === "grid" && loc.name === sceneName);
    if (gridParent) {
      return generateScene({
        novelId: input.novelId,
        sceneName,
        referenceUrls: input.referenceUrls,
        model: input.model,
        mode: "grid",
      });
    }

    const subLocationGridParent = analyzed.find(
      (loc) => loc.mode === "grid" && loc.realSubs.some((sub) => sub.name === sceneName),
    );
    if (subLocationGridParent) {
      const gridKey = `scene_${subLocationGridParent.name.replace(/\s+/g, "_")}_grid`;
      const gridResource = await prisma.keyResource.findFirst({
        where: { scopeType: "novel", scopeId: input.novelId, key: gridKey, currentVersion: { gt: 0 } },
        include: { versions: { orderBy: { version: "desc" }, take: 1 } },
      });
      const gridUrl = gridResource?.versions[0]?.url ?? null;
      if (!gridUrl) {
        await generateScene({
          novelId: input.novelId,
          sceneName: subLocationGridParent.name,
          mode: "grid",
          model: input.model,
        });
      }
      return generateScene({
        novelId: input.novelId,
        sceneName,
        referenceUrls: input.referenceUrls,
        model: input.model,
        mode: "hd",
      });
    }
  }

  const styleByMode: Record<string, string> = {
    single: "location_style",
    grid: "location_grid_style",
    hd: "sub_location_style",
  };
  const style = await resolveStyle(styleByMode[input.mode]!);
  const styleRefUrl = style.styleRefUrl;

  if (input.mode === "grid") {
    const { locationBible } = await getNovelLevelData(input.novelId);
    const analyzed = analyzeLocations(locationBible);
    const parent = analyzed.find((loc) => loc.name === sceneName);
    if (!parent) throw new Error(`Parent location "${sceneName}" not found`);
    if (parent.mode !== "grid") {
      throw new Error(`Location "${sceneName}" not eligible for grid mode (need ≥2 sub-locations)`);
    }

    const slots: string[] = [`【格 1】${parent.name}：${parent.visualPrompt}`];
    parent.realSubs.forEach((sub, i) => {
      slots.push(`【格 ${i + 2}】${sub.name}：${sub.visualPrompt}`);
    });

    const prompt = compileTemplate(style.stylePrompt, {
      name: sceneName,
      gridSize: String(parent.gridSize),
      gridSlots: slots.join("\n"),
    });

    const gridRefs = styleRefUrl
      ? [styleRefUrl, ...(input.referenceUrls ?? [])]
      : input.referenceUrls;

    const key = `scene_${sceneName.replace(/\s+/g, "_")}_grid`;
    return generateAndPersistImage({
      scopeType: "novel",
      scopeId: input.novelId,
      key,
      category: "场景",
      prompt,
      title: `${sceneName} (grid)`,
      refUrls: gridRefs,
      model: input.model,
    });
  } else if (input.mode === "hd") {
    const { locationBible } = await getNovelLevelData(input.novelId);
    const analyzed = analyzeLocations(locationBible);

    let parentLoc: AnalyzedLocation | undefined;
    for (const loc of analyzed) {
      if (loc.realSubs.some((s) => s.name === sceneName)) {
        parentLoc = loc;
        break;
      }
    }
    if (!parentLoc) {
      throw new Error(`Scene "${sceneName}" not found as a sub-location`);
    }

    const gridKey = `scene_${parentLoc.name.replace(/\s+/g, "_")}_grid`;
    const gridResource = await prisma.keyResource.findFirst({
      where: { scopeType: "novel", scopeId: input.novelId, key: gridKey, currentVersion: { gt: 0 } },
      include: { versions: { orderBy: { version: "desc" }, take: 1 } },
    });
    const gridUrl = gridResource?.versions[0]?.url ?? null;
    if (!gridUrl) {
      throw new Error(`Grid image for parent "${parentLoc.name}" not yet generated`);
    }

    const prompt = compileTemplate(style.stylePrompt, { name: sceneName, sceneName });

    const hdRefs: string[] = [gridUrl];
    if (styleRefUrl) hdRefs.push(styleRefUrl);
    if (input.referenceUrls) hdRefs.push(...input.referenceUrls);

    const key = `scene_${sceneName.replace(/\s+/g, "_")}`;
    return generateAndPersistImage({
      scopeType: "novel",
      scopeId: input.novelId,
      key,
      category: "场景",
      prompt,
      title: sceneName,
      refUrls: hdRefs,
      model: input.model,
    });
  } else {
    const { locationBible } = await getNovelLevelData(input.novelId);
    let visualPrompt: string | undefined;
    for (const loc of locationBible) {
      if (String(loc.name) === sceneName && loc.visual_prompt) {
        visualPrompt = String(loc.visual_prompt);
        break;
      }
      const subs = loc.sub_locations as Array<Record<string, unknown>> | undefined;
      if (subs) {
        const sub = subs.find((s) => String(s.name) === sceneName);
        if (sub?.visual_prompt) {
          visualPrompt = String(sub.visual_prompt);
          break;
        }
      }
    }
    if (!visualPrompt) {
      throw new Error(`No visual_prompt found for scene "${sceneName}"`);
    }

    const prompt = compileTemplate(style.stylePrompt, { name: sceneName, scenePrompt: visualPrompt });

    const singleRefs = styleRefUrl
      ? [styleRefUrl, ...(input.referenceUrls ?? [])]
      : input.referenceUrls;

    const key = `scene_${sceneName.replace(/\s+/g, "_")}`;
    return generateAndPersistImage({
      scopeType: "novel",
      scopeId: input.novelId,
      key,
      category: "场景",
      prompt,
      title: sceneName,
      refUrls: singleRefs,
      model: input.model,
    });
  }
}

/* ------------------------------------------------------------------ */
/*  Costume generation                                                 */
/* ------------------------------------------------------------------ */

export const GenerateCostumeParams = z.object({
  scriptId: z.string().min(1),
  characterName: z.string().min(1),
  referenceUrls: z.array(z.string().url()).optional(),
  styleName: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
});

export type GenerateCostumeInput = z.infer<typeof GenerateCostumeParams>;

export async function generateCostume(
  input: GenerateCostumeInput,
): Promise<GenerateAndPersistImageResult> {
  const script = await prisma.novelScript.findUnique({
    where: { id: input.scriptId },
    select: { novelId: true, initResult: true },
  });
  if (!script) throw new Error(`Episode not found: ${input.scriptId}`);

  const ir = script.initResult as Record<string, unknown> | null;
  const outfits = ir?.character_outfits as Record<string, string> | undefined;
  const demographics = outfits?.[input.characterName];
  if (!demographics) throw new Error(`No outfit for "${input.characterName}"`);

  const style = await resolveStyle(input.styleName ?? "update_portrait_style");
  const styleRefUrl = style.styleRefUrl;

  const prompt = compileTemplate(style.stylePrompt, { appearance_desc: demographics });

  const portraitKey = `char_${input.characterName.toLowerCase().replace(/\s+/g, "_")}_portrait`;
  const portrait = await prisma.keyResource.findFirst({
    where: { scopeType: "novel", scopeId: script.novelId, key: portraitKey, currentVersion: { gt: 0 } },
    include: { versions: { orderBy: { version: "asc" } } },
  });
  const portraitUrl = portrait ? currentResourceVersion(portrait)?.url ?? null : null;

  const refParts: string[] = [];
  if (styleRefUrl) refParts.push(styleRefUrl);
  if (portraitUrl) refParts.push(portraitUrl);
  const finalRefUrls = refParts.length > 0 || input.referenceUrls
    ? [...refParts, ...(input.referenceUrls ?? [])]
    : undefined;

  const key = `costume_${input.characterName.toLowerCase().replace(/\s+/g, "_")}`;
  return generateAndPersistImage({
    scopeType: "script",
    scopeId: input.scriptId,
    key,
    category: "换装",
    prompt,
    title: input.characterName,
    refUrls: finalRefUrls,
    model: input.model,
  });
}

/* ------------------------------------------------------------------ */
/*  Video prompt execution                                             */
/* ------------------------------------------------------------------ */

export const ExecuteVideoPromptParams = z.object({
  scriptId: z.string().min(1),
  key: z.string().min(1),
  prompt: z.string().min(1),
  definition: z.string().min(1),
  duration: z.number().min(4).max(15),
  provider: z.enum(["jimeng", "happyhorse"]).optional().default("jimeng"),
  resolution: z.enum(["1080P", "720P"]).optional(),
  ratio: z.enum(["16:9", "9:16", "1:1", "4:3", "3:4"]).optional().default("9:16"),
  model: z.string().min(1).optional(),
  previousVideoUrl: z.string().url().optional(),
  previousFrameUrl: z.string().url().optional(),
  continuationTailSeconds: z.number().min(1).max(15).optional().default(15),
  title: z.string().optional(),
}).superRefine((value, ctx) => {
  if (value.previousVideoUrl && !value.previousFrameUrl) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["previousFrameUrl"],
      message: "previousFrameUrl is required when previousVideoUrl is provided",
    });
  }
  if (value.previousFrameUrl && !value.previousVideoUrl) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["previousVideoUrl"],
      message: "previousVideoUrl is required when previousFrameUrl is provided",
    });
  }
});
export type ExecuteVideoPromptInput = z.infer<typeof ExecuteVideoPromptParams>;

export function videoResourceKeyFromPromptKey(promptKey: string): string {
  return promptKey.startsWith("video_") ? promptKey : `video_${promptKey}`;
}

function dedupeStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

interface CurrentImageResource {
  key: string;
  scopeType: string;
  category: string | null;
  title: string | null;
  url: string;
  data: Prisma.JsonValue;
}

interface DefinitionImageRef {
  label: string;
  text: string;
  start: number;
  end: number;
}

function currentResourceVersion<
  T extends {
    currentVersion: number;
    versions: Array<{ version: number; url: string | null; data: Prisma.JsonValue }>;
  },
>(resource: T): { version: number; url: string | null; data: Prisma.JsonValue } | null {
  return resource.versions.find((version) => version.version === resource.currentVersion) ?? null;
}

function imageReferenceLabels(definition: string): DefinitionImageRef[] {
  const refs: DefinitionImageRef[] = [];
  const pattern = /@图\d+\s*是\s*\[([^\]]+)\][^\n\r]*/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(definition)) !== null) {
    const label = match[1]?.trim();
    if (!label) continue;
    refs.push({
      label,
      text: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return refs;
}

function labelMatchesResource(label: string, resource: CurrentImageResource): boolean {
  const title = resource.title?.trim();
  return !!title && (label.includes(title) || title.includes(label));
}

function findImageResourceForLabel(
  label: string,
  imageResources: CurrentImageResource[],
): CurrentImageResource | null {
  const costume = imageResources.find((resource) => (
    resource.scopeType === "script" &&
    resource.category === "换装" &&
    labelMatchesResource(label, resource)
  ));
  if (costume) return costume;

  return imageResources.find((resource) => labelMatchesResource(label, resource)) ?? null;
}

function rangeContains(ranges: DefinitionImageRef[], index: number): boolean {
  return ranges.some((range) => index >= range.start && index < range.end);
}

function extractStandaloneCurrentUrls(
  definition: string,
  consumedRanges: DefinitionImageRef[],
  allowedUrls: Set<string>,
): string[] {
  const matches = definition.matchAll(/https?:\/\/[^\s，。；、)）\]}]+/g);
  const urls: string[] = [];
  for (const match of matches) {
    const url = match[0];
    if (match.index !== undefined && rangeContains(consumedRanges, match.index)) continue;
    if (allowedUrls.has(url)) urls.push(url);
  }
  return dedupeStrings(urls);
}

async function resolveVideoReferenceImages(
  urls: string[],
  compressedUrlByOriginal: Map<string, string>,
  key: string,
): Promise<{ urls: string[]; compression: ImageCompressionResult[] }> {
  const cache = new Map<string, ImageCompressionResult>();
  const compression: ImageCompressionResult[] = [];
  const resolvedUrls: string[] = [];

  for (const url of dedupeStrings(urls)) {
    const knownCompressedUrl = compressedUrlByOriginal.get(url);
    if (knownCompressedUrl) {
      const result: ImageCompressionResult = {
        originalUrl: url,
        compressedUrl: knownCompressedUrl,
        originalBytes: 0,
        compressedBytes: 0,
        format: "known-resource",
        uploaded: knownCompressedUrl !== url,
        note: "reused compressed URL from image resource metadata",
      };
      compression.push(result);
      resolvedUrls.push(result.compressedUrl);
      continue;
    }

    const cached = cache.get(url);
    const result = cached ?? await compressImageUrlLosslessBestEffort(url, key);
    cache.set(url, result);
    compression.push(result);
    resolvedUrls.push(result.compressedUrl);
  }

  return {
    urls: dedupeStrings(resolvedUrls),
    compression,
  };
}

async function resolveLastFrameUrl(
  videoUrl: string,
  generatedLastFrameUrl: string | undefined,
): Promise<string> {
  if (generatedLastFrameUrl) return generatedLastFrameUrl;
  if (process.env.FC_EXTRACT_LAST_FRAME_URL && process.env.FC_EXTRACT_LAST_FRAME_TOKEN) {
    return callFcExtractLastFrame({ videoUrl });
  }
  throw new Error(
    "Video generation returned no lastFrameUrl. Configure FC_EXTRACT_LAST_FRAME_URL/TOKEN or return { videoUrl, lastFrameUrl } from FC_GENERATE_VIDEO_URL.",
  );
}

export async function executeVideoPrompt(
  input: ExecuteVideoPromptInput,
): Promise<ExecuteVideoPromptResult> {
  const script = await prisma.novelScript.findUnique({
    where: { id: input.scriptId },
    select: { novelId: true },
  });
  if (!script) throw new Error(`Episode not found: ${input.scriptId}`);

  const allResources = await prisma.keyResource.findMany({
    where: {
      OR: [
        { scopeType: "novel", scopeId: script.novelId },
        { scopeType: "script", scopeId: input.scriptId },
      ],
      currentVersion: { gt: 0 },
    },
    include: { versions: { orderBy: { version: "asc" } } },
  });
  const imageResources: CurrentImageResource[] = allResources
    .filter((resource) => resource.mediaType === "image")
    .map((resource): CurrentImageResource | null => {
      const version = currentResourceVersion(resource);
      if (!version?.url) return null;
      return {
        key: resource.key,
        scopeType: resource.scopeType,
        category: resource.category,
        title: resource.title,
        url: version.url,
        data: version.data,
      };
    })
    .filter((resource): resource is CurrentImageResource => resource !== null);
  const currentImageUrls = new Set(imageResources.map((resource) => resource.url));

  const compressedUrlByOriginal = new Map<string, string>();
  for (const resource of imageResources) {
    const compressedUrl = compressedUrlFromResourceData(resource.data);
    if (compressedUrl) {
      compressedUrlByOriginal.set(resource.url, compressedUrl);
      compressedUrlByOriginal.set(compressedUrl, compressedUrl);
    }
  }

  const refImageUrls: string[] = [];
  const namedImageRefs = imageReferenceLabels(input.definition);
  for (const ref of namedImageRefs) {
    const matched = findImageResourceForLabel(ref.label, imageResources);
    if (matched && !refImageUrls.includes(matched.url)) {
      refImageUrls.push(matched.url);
      continue;
    }
    for (const url of extractUrls(ref.text).filter((candidate) => currentImageUrls.has(candidate))) {
      if (!refImageUrls.includes(url)) refImageUrls.push(url);
    }
  }
  for (const url of extractStandaloneCurrentUrls(input.definition, namedImageRefs, currentImageUrls)) {
    if (!refImageUrls.includes(url)) {
      refImageUrls.push(url);
    }
  }

  const videoStyle = await resolveStyle("video_style");
  if (input.previousFrameUrl && !refImageUrls.includes(input.previousFrameUrl)) {
    refImageUrls.unshift(input.previousFrameUrl);
  }
  if (videoStyle.styleRefUrl) refImageUrls.unshift(videoStyle.styleRefUrl);

  const resolvedReferenceImages = await resolveVideoReferenceImages(
    refImageUrls,
    compressedUrlByOriginal,
    input.key,
  );
  const videoRefImageUrls = resolvedReferenceImages.urls;
  const sourceImageUrl = input.previousFrameUrl
    ? (resolvedReferenceImages.compression.find((item) => item.originalUrl === input.previousFrameUrl)?.compressedUrl
      ?? input.previousFrameUrl)
    : videoRefImageUrls[0];

  let sourceVideoUrls: string[] | undefined;
  let continuationVideoMode: "cropped-tail" | "full-previous-video" | undefined;
  if (input.previousVideoUrl) {
    if (process.env.FC_CROP_VIDEO_URL && process.env.FC_CROP_VIDEO_TOKEN) {
      try {
        const tailUrl = await callFcCropVideo({
          videoUrl: input.previousVideoUrl,
          tailSeconds: input.continuationTailSeconds,
        });
        sourceVideoUrls = [tailUrl];
        continuationVideoMode = "cropped-tail";
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to prepare previous clip continuation video: ${message}`);
      }
    } else {
      sourceVideoUrls = [input.previousVideoUrl];
      continuationVideoMode = "full-previous-video";
    }
  }

  const compiledPrompt = compileTemplate(videoStyle.stylePrompt, {
    definition: input.definition,
    prompt: input.prompt,
  });

  const generatedVideo = input.provider === "happyhorse"
    ? { videoUrl: await generateHappyHorseVideo({
      prompt: compiledPrompt,
      referenceImageUrls: videoRefImageUrls,
      sourceVideoUrls: sourceVideoUrls ?? [],
      duration: input.duration,
      resolution: input.resolution,
      ratio: input.ratio,
      model: input.model,
    }) }
    : await callFcGenerateVideo({
      prompt: compiledPrompt,
      sourceImageUrl,
      referenceImageUrls: videoRefImageUrls.length > 0 ? videoRefImageUrls : undefined,
      sourceVideoUrls,
      duration: input.duration,
      ratio: input.ratio,
      resolution: input.resolution,
    });
  const videoUrl = generatedVideo.videoUrl;
  const lastFrameUrl = await resolveLastFrameUrl(videoUrl, generatedVideo.lastFrameUrl);
  const videoKey = videoResourceKeyFromPromptKey(input.key);

  const videoData: Prisma.InputJsonObject = {
    promptKey: input.key,
    duration: input.duration,
    provider: input.provider,
    ratio: input.ratio,
    ...(input.resolution ? { resolution: input.resolution } : {}),
    lastFrameUrl,
    continuationTailSeconds: input.continuationTailSeconds,
    ...(input.previousVideoUrl ? { previousVideoUrl: input.previousVideoUrl } : {}),
    ...(input.previousFrameUrl ? { previousFrameUrl: input.previousFrameUrl } : {}),
    ...(sourceVideoUrls ? { sourceVideoUrls, continuationVideoMode } : {}),
    referenceImageCompression: resolvedReferenceImages.compression.map(imageCompressionResultToJson),
    originalReferenceImageUrls: refImageUrls,
    compressedReferenceImageUrls: videoRefImageUrls,
    ...(sourceImageUrl ? { sourceImageUrl } : {}),
  };

  const kr = await keyResourceService.upsertResource(
    "script",
    input.scriptId,
    videoKey,
    "video",
    {
      prompt: compiledPrompt,
      url: videoUrl,
      refUrls: [...videoRefImageUrls, ...(sourceVideoUrls ?? [])],
      data: videoData,
    },
  );
  await setKeyResourceMetadata(kr.id, "视频", input.title ?? input.key);

  return {
    status: "ok",
    key: input.key,
    videoKey,
    keyResourceId: kr.id,
    version: kr.version,
    videoUrl,
    lastFrameUrl,
    sourceVideoUrls,
    previousVideoUrl: input.previousVideoUrl,
    previousFrameUrl: input.previousFrameUrl,
    referenceImageCount: refImageUrls.length,
    prompt: compiledPrompt,
  };
}

function extractUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s，。；、)）\]}]+/g) ?? [];
  return Array.from(new Set(matches));
}

async function generateHappyHorseVideo(input: {
  prompt: string;
  referenceImageUrls: string[];
  sourceVideoUrls: string[];
  duration: number;
  resolution?: "1080P" | "720P";
  ratio?: "16:9" | "9:16" | "1:1" | "4:3" | "3:4";
  model?: string;
}): Promise<string> {
  if (input.prompt.length > 2500) {
    throw new Error(
      `HappyHorse prompt exceeds 2500 characters after video_style compilation: ${input.prompt.length}`,
    );
  }

  const media: MediaItem[] = [
    ...input.sourceVideoUrls.map((url): MediaItem => ({ type: "video", url })),
    ...input.referenceImageUrls.map((url): MediaItem => ({ type: "reference_image", url })),
  ];

  if (media.length === 0) {
    throw new Error("HappyHorse requires at least one video or reference image");
  }

  const result = await callFcHappyHorseGenerate({
    prompt: input.prompt,
    media,
    duration: input.duration,
    resolution: input.resolution,
    ratio: input.ratio,
    model: input.model,
  });

  if (!result.videoUrl) {
    throw new Error(`HappyHorse generation failed: no videoUrl in response`);
  }

  return result.videoUrl;
}

/* ------------------------------------------------------------------ */
/*  Batch generation                                                   */
/* ------------------------------------------------------------------ */

export const BatchGeneratePortraitsParams = z.object({
  novelId: z.string().min(1),
  characterNames: z.array(z.string().min(1)),
  styleName: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
});

export type BatchGeneratePortraitsInput = z.infer<typeof BatchGeneratePortraitsParams>;

export interface BatchGeneratePortraitsResult {
  results: Array<{
    characterName: string;
    status: "ok" | "error";
    key?: string;
    keyResourceId?: string;
    imageUrl?: string;
    version?: number;
    error?: string;
  }>;
}

export async function batchGeneratePortraits(
  input: BatchGeneratePortraitsInput,
): Promise<BatchGeneratePortraitsResult> {
  const results = await Promise.allSettled(
    input.characterNames.map((characterName) =>
      generatePortrait({
        novelId: input.novelId,
        characterName,
        styleName: input.styleName,
        model: input.model,
      }),
    ),
  );

  return {
    results: results.map((result, index) => {
      const characterName = input.characterNames[index]!;
      if (result.status === "fulfilled") {
        const data = result.value;
        return {
          characterName,
          status: data.status,
          key: data.key,
          keyResourceId: data.keyResourceId,
          imageUrl: data.imageUrl,
          version: data.version,
          error: data.error,
        };
      } else {
        return {
          characterName,
          status: "error" as const,
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        };
      }
    }),
  };
}

export const BatchGenerateScenesParams = z.object({
  novelId: z.string().min(1),
  sceneNames: z.array(z.string().min(1)),
  mode: z.enum(["single", "grid", "hd"]).default("single"),
  model: z.string().min(1).optional(),
});

export type BatchGenerateScenesInput = z.infer<typeof BatchGenerateScenesParams>;

export interface BatchGenerateScenesResult {
  results: Array<{
    sceneName: string;
    mode?: "single" | "grid" | "hd";
    status: "ok" | "error";
    key?: string;
    keyResourceId?: string;
    imageUrl?: string;
    version?: number;
    error?: string;
  }>;
}

function uniqueNonEmptyNames(names: string[]): string[] {
  const seen = new Set<string>();
  const uniqueNames: string[] = [];
  for (const rawName of names) {
    const name = rawName.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    uniqueNames.push(name);
  }
  return uniqueNames;
}

function sceneSuccessResult(
  sceneName: string,
  mode: "single" | "grid" | "hd",
  data: GenerateAndPersistImageResult,
): BatchGenerateScenesResult["results"][number] {
  return {
    sceneName,
    mode,
    status: data.status,
    key: data.key,
    keyResourceId: data.keyResourceId,
    imageUrl: data.imageUrl,
    version: data.version,
    error: data.error,
  };
}

function sceneErrorResult(
  sceneName: string,
  mode: "single" | "grid" | "hd",
  error: unknown,
): BatchGenerateScenesResult["results"][number] {
  return {
    sceneName,
    mode,
    status: "error",
    error: error instanceof Error ? error.message : String(error),
  };
}

function findGridParentForScene(
  analyzed: AnalyzedLocation[],
  sceneName: string,
): { parent: AnalyzedLocation; requestedSubName: string | null } | null {
  const directParent = analyzed.find((loc) => loc.name === sceneName);
  if (directParent) return { parent: directParent, requestedSubName: null };

  for (const loc of analyzed) {
    const sub = loc.realSubs.find((candidate) => candidate.name === sceneName);
    if (sub) return { parent: loc, requestedSubName: sub.name };
  }

  return null;
}

async function generateSceneResult(
  novelId: string,
  sceneName: string,
  mode: "single" | "grid" | "hd",
  model: string | undefined,
): Promise<BatchGenerateScenesResult["results"][number]> {
  try {
    const data = await generateScene({
      novelId,
      sceneName,
      mode,
      model,
    });
    return sceneSuccessResult(sceneName, mode, data);
  } catch (error: unknown) {
    return sceneErrorResult(sceneName, mode, error);
  }
}

function parentNameForSubScene(
  analyzed: AnalyzedLocation[],
  sceneName: string,
): string | null {
  for (const loc of analyzed) {
    if (loc.realSubs.some((sub) => sub.name === sceneName)) return loc.name;
  }
  return null;
}

async function generateGridParentAndHdScenes(
  novelId: string,
  parent: AnalyzedLocation,
  requestedSubNames: string[] | null,
  model: string | undefined,
): Promise<BatchGenerateScenesResult["results"]> {
  const gridResult = await generateSceneResult(novelId, parent.name, "grid", model);
  if (gridResult.status === "error") return [gridResult];

  const hdSceneNames = requestedSubNames
    ? requestedSubNames
    : parent.realSubs.map((sub) => sub.name);
  const hdResults = await Promise.all(
    hdSceneNames.map((subName) => generateSceneResult(novelId, subName, "hd", model)),
  );

  return [gridResult, ...hdResults];
}

async function batchGenerateGridSceneWorkflow(
  input: BatchGenerateScenesInput,
): Promise<BatchGenerateScenesResult> {
  const { locationBible } = await getNovelLevelData(input.novelId);
  const analyzed = analyzeLocations(locationBible);
  const requestedNames = await resolveSceneIdentifiers(
    input.novelId,
    uniqueNonEmptyNames(input.sceneNames),
  );
  const results: BatchGenerateScenesResult["results"] = [];
  const singleNames: string[] = [];
  const gridRequests = new Map<string, {
    parent: AnalyzedLocation;
    includeAllSubs: boolean;
    requestedSubNames: Set<string>;
  }>();

  for (const requested of requestedNames) {
    const match = findGridParentForScene(analyzed, requested.sceneName);
    if (!match) {
      results.push(sceneErrorResult(requested.requestedName, "grid", new Error(`Scene "${requested.sceneName}" not found`)));
      continue;
    }

    const { parent, requestedSubName } = match;
    if (parent.mode !== "grid") {
      singleNames.push(requested.sceneName);
      continue;
    }

    const existingRequest = gridRequests.get(parent.name);
    const gridRequest = existingRequest ?? {
      parent,
      includeAllSubs: false,
      requestedSubNames: new Set<string>(),
    };

    if (requestedSubName) {
      gridRequest.requestedSubNames.add(requestedSubName);
    } else {
      gridRequest.includeAllSubs = true;
    }

    if (!existingRequest) {
      gridRequests.set(parent.name, gridRequest);
      continue;
    }
  }

  const [singleResults, gridResults] = await Promise.all([
    Promise.all(
      singleNames.map((sceneName) => generateSceneResult(input.novelId, sceneName, "single", input.model)),
    ),
    Promise.all(
      Array.from(gridRequests.values()).map((request) => generateGridParentAndHdScenes(
        input.novelId,
        request.parent,
        request.includeAllSubs ? null : Array.from(request.requestedSubNames),
        input.model,
      )),
    ),
  ]);

  results.push(...singleResults);
  results.push(...gridResults.flat());

  return { results };
}

export async function batchGenerateScenes(
  input: BatchGenerateScenesInput,
): Promise<BatchGenerateScenesResult> {
  if (input.mode === "grid") {
    return batchGenerateGridSceneWorkflow(input);
  }

  const { locationBible } = await getNovelLevelData(input.novelId);
  const analyzed = analyzeLocations(locationBible);
  const requestedScenes = await resolveSceneIdentifiers(
    input.novelId,
    uniqueNonEmptyNames(input.sceneNames),
  );
  const results: BatchGenerateScenesResult["results"] = [];
  const processedScenes = new Set<string>();
  const singleOrHdRequests: Array<{ sceneName: string; mode: "single" | "hd" }> = [];
  const gridRequests: string[] = [];

  for (const requested of requestedScenes) {
    const effectiveMode = requested.placeholderMode === "grid" ? "grid" : input.mode;
    const dedupeKey = `${effectiveMode}:${requested.sceneName}`;
    if (processedScenes.has(dedupeKey)) continue;

    const requestedGridParent = analyzed.find(
      (loc) => loc.mode === "grid" && loc.name === requested.sceneName,
    );
    if (input.mode === "single" && requestedGridParent) {
      gridRequests.push(requested.sceneName);
      processedScenes.add(dedupeKey);
      continue;
    }

    const parentName = parentNameForSubScene(analyzed, requested.sceneName);
    const gridParent = parentName
      ? analyzed.find((loc) => loc.name === parentName && loc.mode === "grid")
      : undefined;
    if (input.mode === "single" && gridParent) {
      gridRequests.push(requested.sceneName);
      processedScenes.add(dedupeKey);
      continue;
    }

    if (effectiveMode === "grid") {
      gridRequests.push(requested.sceneName);
      processedScenes.add(dedupeKey);
      continue;
    }

    singleOrHdRequests.push({ sceneName: requested.sceneName, mode: effectiveMode });
    processedScenes.add(dedupeKey);
  }

  const [nonGridResults, gridResults] = await Promise.all([
    Promise.all(
      singleOrHdRequests.map((request) => generateSceneResult(
        input.novelId,
        request.sceneName,
        request.mode,
        input.model,
      )),
    ),
    Promise.all(
      gridRequests.length === 0 ? [] : [gridRequests].map(async (sceneNames) => {
        const gridResult = await batchGenerateGridSceneWorkflow({
          novelId: input.novelId,
          sceneNames,
          mode: "grid",
          model: input.model,
        });
        return gridResult.results;
      }),
    ),
  ]);

  results.push(...nonGridResults);
  results.push(...gridResults.flat());

  return { results };
}

/* ------------------------------------------------------------------ */
/*  Batch costume generation                                           */
/* ------------------------------------------------------------------ */

export const BatchGenerateCostumesParams = z.object({
  scriptId: z.string().min(1),
  characterNames: z.array(z.string().min(1)),
  styleName: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
});

export type BatchGenerateCostumesInput = z.infer<typeof BatchGenerateCostumesParams>;

export interface BatchGenerateCostumesResult {
  results: Array<{
    characterName: string;
    status: "ok" | "error";
    key?: string;
    keyResourceId?: string;
    imageUrl?: string;
    version?: number;
    error?: string;
  }>;
}

export async function batchGenerateCostumes(
  input: BatchGenerateCostumesInput,
): Promise<BatchGenerateCostumesResult> {
  const results = await Promise.allSettled(
    input.characterNames.map((characterName) =>
      generateCostume({
        scriptId: input.scriptId,
        characterName,
        styleName: input.styleName,
        model: input.model,
      }),
    ),
  );

  return {
    results: results.map((result, index) => {
      const characterName = input.characterNames[index]!;
      if (result.status === "fulfilled") {
        const data = result.value;
        return {
          characterName,
          status: data.status,
          key: data.key,
          keyResourceId: data.keyResourceId,
          imageUrl: data.imageUrl,
          version: data.version,
          error: data.error,
        };
      } else {
        return {
          characterName,
          status: "error" as const,
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        };
      }
    }),
  };
}
