/**
 * Video Asset Generation Service - Image and video generation
 * 
 * This service handles:
 * - Portrait generation (character images)
 * - Scene generation (location images, grids, HD)
 * - Costume generation (character outfits)
 * - Video shot execution
 */

import { z } from "zod";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma";
import type {
  StylePreset,
  AnalyzedLocation,
  GenerateAndPersistImageInput,
  GenerateAndPersistImageResult,
  ExecuteVideoShotResult,
} from "@/lib/video/asset-generation-types";
import * as keyResourceService from "./key-resource-service";
import { callFcGenerateVideo, callFcCropVideo } from "./fc-video-client";
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
  });

  await setKeyResourceMetadata(gen.id, input.category, input.title);

  return {
    url: gen.imageUrl,
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

  const style = await resolveStyle(input.styleName ?? "costume_style");
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
/*  Video shot execution                                               */
/* ------------------------------------------------------------------ */

export const ExecuteVideoShotParams = z.object({
  scriptId: z.string().min(1),
  key: z.string().min(1),
  shotPrompt: z.string().min(1),
  definition: z.string().min(1),
  duration: z.number().min(4).max(15),
  previousVideoUrl: z.string().url().optional(),
  title: z.string().optional(),
});

export type ExecuteVideoShotInput = z.infer<typeof ExecuteVideoShotParams>;

export async function executeVideoShot(
  input: ExecuteVideoShotInput,
): Promise<ExecuteVideoShotResult> {
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

  const refImageUrls: string[] = [];
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
    if (matched) refImageUrls.push(matched);
  }

  const shotStyle = await resolveStyle("video_style");
  if (shotStyle.styleRefUrl) refImageUrls.unshift(shotStyle.styleRefUrl);

  let sourceVideoUrls: string[] | undefined;
  if (input.previousVideoUrl) {
    try {
      const tailUrl = await callFcCropVideo({
        videoUrl: input.previousVideoUrl,
        startTime: Math.max(0, input.duration - 5),
        endTime: input.duration,
      });
      sourceVideoUrls = [tailUrl];
    } catch {
      // Continue without continuation
    }
  }

  const shotPromptCompiled = compileTemplate(shotStyle.stylePrompt, {
    definition: input.definition,
    prompt: input.shotPrompt,
  });

  const videoUrl = await callFcGenerateVideo({
    prompt: shotPromptCompiled,
    referenceImageUrls: refImageUrls.length > 0 ? refImageUrls : undefined,
    sourceVideoUrls,
  });

  const kr = await keyResourceService.upsertResource(
    "script",
    input.scriptId,
    input.key,
    "video",
    {
      prompt: shotPromptCompiled,
      url: videoUrl,
      refUrls: [...refImageUrls, ...(sourceVideoUrls ?? [])],
      data: { duration: input.duration } as Prisma.InputJsonValue,
    },
  );
  await setKeyResourceMetadata(kr.id, "视频", input.title ?? input.key);

  return {
    status: "ok",
    key: input.key,
    keyResourceId: kr.id,
    version: kr.version,
    videoUrl,
    referenceImageCount: refImageUrls.length,
    prompt: shotPromptCompiled,
  };
}
