/**
 * Video Coordination Service - Coordinates complex operations across multiple services
 * 
 * This service handles operations that require coordination between:
 * - novel-service
 * - episode-service
 * - video-resource-service
 */

import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma";
import type { NovelScriptUpload, ScriptEpisode } from "@/lib/video/script-upload-schema";
import type { EpisodeSummary } from "@/lib/video/episode-types";
import type { ResourceDiff } from "@/lib/video/resource-types";
import * as novelService from "./novel-service";
import * as episodeService from "./episode-service";
import * as resourceService from "./video-resource-service";

/**
 * Helper: Generate script key from episode metadata
 */
function scriptKeyForEpisode(episode: ScriptEpisode): string {
  return episode.variant_kind === "mainline"
    ? `EP${episode.ep_num}`
    : `EP${episode.ep_num}-${episode.variant_kind}`;
}

/**
 * Create a novel with script and episodes
 * Coordinates: novel creation + episode insertion + resource inference
 */
export async function createNovelWithScript(
  name: string,
  upload: NovelScriptUpload,
): Promise<{ novelId: string; episodes: EpisodeSummary[]; diff: ResourceDiff }> {
  const episodes = upload.episodes ?? [];

  // Create novel
  const novel = await novelService.createNovelOnly(name, upload);

  // Insert episodes
  const created = await episodeService.insertEpisodes(novel.id, episodes);

  // Create expected resources and compute diff
  const diff = await resourceService.createEmptyKeyResourcesWithDiff(novel.id, upload, created);

  return { novelId: novel.id, episodes: created, diff };
}

/**
 * Replace script for an existing novel
 * Coordinates: episode updates + novel metadata update + resource inference
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

  const diff = await resourceService.createEmptyKeyResourcesWithDiff(novelId, upload, result);

  return { episodes: result, diff };
}

/**
 * Delete a novel with cascade
 * Coordinates: delete all episodes + delete novel + delete resources
 */
export async function deleteNovel(novelId: string): Promise<void> {
  // Get all episodes
  const episodes = await episodeService.listEpisodes(novelId);

  // Delete each episode (handles resources and sessions)
  for (const episode of episodes) {
    await episodeService.deleteEpisode(episode.id);
  }

  // Delete novel-scoped resources and the novel itself
  await novelService.deleteNovelOnly(novelId);
}
