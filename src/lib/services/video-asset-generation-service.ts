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
    const parent = analyzed.find((loc) => loc.name === input.sceneName);
    if (!parent) throw new Error(`Parent location "${input.sceneName}" not found`);
    if (parent.mode !== "grid") {
      throw new Error(`Location "${input.sceneName}" not eligible for grid mode (need ≥2 sub-locations)`);
    }

    const slots: string[] = [`【格 1】${parent.name}：${parent.visualPrompt}`];
    parent.realSubs.forEach((sub, i) => {
      slots.push(`【格 ${i + 2}】${sub.name}：${sub.visualPrompt}`);
    });

    const prompt = compileTemplate(style.stylePrompt, {
      name: input.sceneName,
      gridSize: String(parent.gridSize),
      gridSlots: slots.join("\n"),
    });

    const gridRefs = styleRefUrl
      ? [styleRefUrl, ...(input.referenceUrls ?? [])]
      : input.referenceUrls;

    const key = `scene_${input.sceneName.replace(/\s+/g, "_")}_grid`;
    return generateAndPersistImage({
      scopeType: "novel",
      scopeId: input.novelId,
      key,
      category: "场景",
      prompt,
      title: `${input.sceneName} (grid)`,
      refUrls: gridRefs,
      model: input.model,
    });
  } else if (input.mode === "hd") {
    const { locationBible } = await getNovelLevelData(input.novelId);
    const analyzed = analyzeLocations(locationBible);

    let parentLoc: AnalyzedLocation | undefined;
    for (const loc of analyzed) {
      if (loc.realSubs.some((s) => s.name === input.sceneName)) {
        parentLoc = loc;
        break;
      }
    }
    if (!parentLoc) {
      throw new Error(`Scene "${input.sceneName}" not found as a sub-location`);
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

    const prompt = compileTemplate(style.stylePrompt, { name: input.sceneName, sceneName: input.sceneName });

    const hdRefs: string[] = [gridUrl];
    if (styleRefUrl) hdRefs.push(styleRefUrl);
    if (input.referenceUrls) hdRefs.push(...input.referenceUrls);

    const key = `scene_${input.sceneName.replace(/\s+/g, "_")}`;
    return generateAndPersistImage({
      scopeType: "novel",
      scopeId: input.novelId,
      key,
      category: "场景",
      prompt,
      title: input.sceneName,
      refUrls: hdRefs,
      model: input.model,
    });
  } else {
    const { locationBible } = await getNovelLevelData(input.novelId);
    let visualPrompt: string | undefined;
    for (const loc of locationBible) {
      if (String(loc.name) === input.sceneName && loc.visual_prompt) {
        visualPrompt = String(loc.visual_prompt);
        break;
      }
      const subs = loc.sub_locations as Array<Record<string, unknown>> | undefined;
      if (subs) {
        const sub = subs.find((s) => String(s.name) === input.sceneName);
        if (sub?.visual_prompt) {
          visualPrompt = String(sub.visual_prompt);
          break;
        }
      }
    }
    if (!visualPrompt) {
      throw new Error(`No visual_prompt found for scene "${input.sceneName}"`);
    }

    const prompt = compileTemplate(style.stylePrompt, { name: input.sceneName, scenePrompt: visualPrompt });

    const singleRefs = styleRefUrl
      ? [styleRefUrl, ...(input.referenceUrls ?? [])]
      : input.referenceUrls;

    const key = `scene_${input.sceneName.replace(/\s+/g, "_")}`;
    return generateAndPersistImage({
      scopeType: "novel",
      scopeId: input.novelId,
      key,
      category: "场景",
      prompt,
      title: input.sceneName,
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
    where: { scopeType: "novel", scopeId: script.novelId, key: portraitKey },
    include: { versions: { orderBy: { version: "desc" }, take: 1 } },
  });
  const portraitUrl = portrait?.versions[0]?.url ?? null;

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
    include: { versions: { orderBy: { version: "desc" }, take: 1 } },
  });

  const compressedUrlByOriginal = new Map<string, string>();
  for (const resource of allResources) {
    const version = resource.versions[0];
    const originalUrl = version?.url;
    const compressedUrl = compressedUrlFromResourceData(version?.data);
    if (originalUrl && compressedUrl) {
      compressedUrlByOriginal.set(originalUrl, compressedUrl);
      compressedUrlByOriginal.set(compressedUrl, compressedUrl);
    }
  }

  const refImageUrls: string[] = [];
  for (const url of extractUrls(input.definition)) {
    refImageUrls.push(url);
  }

  const imgRefs = input.definition.match(/@图\d+\s*是\s*\[([^\]]+)\]/g) ?? [];
  for (const ref of imgRefs) {
    const nameMatch = ref.match(/\[([^\]]+)\]/);
    if (!nameMatch) continue;
    const refName = nameMatch[1]!;

    let matched: string | null = null;
    for (const r of allResources) {
      const url = r.versions[0]?.url;
      if (!url) continue;
      const title = r.title ?? "";
      if (!title) continue;
      if (refName.includes(title) || title.includes(refName)) {
        if (matched && r.category === "角色立绘") continue;
        matched = url;
        if (r.category === "换装") break;
      }
    }
    if (matched && !refImageUrls.includes(matched)) refImageUrls.push(matched);
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
    status: "ok" | "error";
    key?: string;
    keyResourceId?: string;
    imageUrl?: string;
    version?: number;
    error?: string;
  }>;
}

export async function batchGenerateScenes(
  input: BatchGenerateScenesInput,
): Promise<BatchGenerateScenesResult> {
  const results = await Promise.allSettled(
    input.sceneNames.map((sceneName) =>
      generateScene({
        novelId: input.novelId,
        sceneName,
        mode: input.mode,
        model: input.model,
      }),
    ),
  );

  return {
    results: results.map((result, index) => {
      const sceneName = input.sceneNames[index]!;
      if (result.status === "fulfilled") {
        const data = result.value;
        return {
          sceneName,
          status: data.status,
          key: data.key,
          keyResourceId: data.keyResourceId,
          imageUrl: data.imageUrl,
          version: data.version,
          error: data.error,
        };
      } else {
        return {
          sceneName,
          status: "error" as const,
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        };
      }
    }),
  };
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
