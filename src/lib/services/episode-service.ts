/**
 * Episode Service - Pure CRUD operations for episodes
 * 
 * This service only handles episode-level database operations.
 * For complex operations involving resources, use video-coordination-service.
 */

import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma";
import type { EpisodeSummary, EpStatus } from "@/lib/video/episode-types";
import type { ScriptEpisode } from "@/lib/video/script-upload-schema";

export interface EpisodeWindowItem {
  scriptId: string;
  scriptKey: string;
  scriptName: string | null;
  scriptContent: string | null;
  initResult: Prisma.JsonValue | null;
  relation: "previous" | "current" | "next";
}

/**
 * Helper: Generate script key from episode metadata
 */
function scriptKeyForEpisode(episode: ScriptEpisode): string {
  return episode.variant_kind === "mainline"
    ? `EP${episode.ep_num}`
    : `EP${episode.ep_num}-${episode.variant_kind}`;
}

function episodeNumberFromScriptKey(scriptKey: string): number | null {
  const match = /^EP(\d+)(?:\D.*)?$/i.exec(scriptKey);
  if (!match?.[1]) return null;
  return Number.parseInt(match[1], 10);
}

/**
 * List all episodes for a novel
 */
export async function listEpisodes(novelId: string): Promise<EpisodeSummary[]> {
  const scripts = await prisma.novelScript.findMany({
    where: { novelId },
    orderBy: { scriptKey: "asc" },
  });

  const episodes: EpisodeSummary[] = [];
  for (const script of scripts) {
    const hasContent = script.scriptContent != null;

    // Check if any generated KeyResources exist for this script
    let hasResources = false;
    if (hasContent) {
      const keyResourceCount = await prisma.keyResource.count({
        where: { scopeType: "script", scopeId: script.id, currentVersion: { gt: 0 } },
      });
      hasResources = keyResourceCount > 0;
    }

    episodes.push({
      id: script.id,
      novelId: script.novelId,
      scriptKey: script.scriptKey,
      scriptName: script.scriptName,
      status: !hasContent ? "empty" : hasResources ? "has_resources" : "uploaded",
      createdAt: script.createdAt.toISOString(),
    });
  }

  return episodes;
}

/**
 * Create a single episode
 */
export async function createEpisode(
  novelId: string,
  scriptKey: string,
  scriptName: string | null,
  scriptContent: string | null,
): Promise<{ id: string }> {
  const script = await prisma.novelScript.create({
    data: {
      novelId,
      scriptKey,
      scriptName,
      scriptContent,
    },
  });
  return { id: script.id };
}

/**
 * Delete an episode and its associated resources
 */
export async function deleteEpisode(scriptId: string): Promise<void> {
  // Look up novel_id + script_key to derive session userName
  const script = await prisma.novelScript.findUnique({
    where: { id: scriptId },
    select: { novelId: true, scriptKey: true },
  });

  // Delete script-scoped KeyResources and DomainResources
  await prisma.keyResource.deleteMany({ where: { scopeType: "script", scopeId: scriptId } });
  await prisma.domainResource.deleteMany({ where: { scopeType: "script", scopeId: scriptId } });

  // Delete the script itself
  await prisma.novelScript.delete({ where: { id: scriptId } });

  // Cascade-delete associated sessions (messages, tasks, events, key resources)
  if (script) {
    const userName = `video:${script.novelId}:${script.scriptKey}`;
    const user = await prisma.user.findUnique({ where: { name: userName } });
    if (user) {
      await prisma.chatSession.deleteMany({ where: { userId: user.id } });
    }
  }
}

/**
 * Get episode script content
 */
export async function getEpisodeContent(scriptId: string): Promise<string | null> {
  const script = await prisma.novelScript.findUnique({
    where: { id: scriptId },
    select: { scriptContent: true },
  });
  return script?.scriptContent ?? null;
}

/**
 * Read the stored init_result (full episode output JSON) for an episode
 */
export async function getEpisodeOutput(
  scriptId: string,
): Promise<Record<string, unknown> | null> {
  const script = await prisma.novelScript.findUnique({
    where: { id: scriptId },
    select: { initResult: true },
  });
  if (!script?.initResult) return null;
  return script.initResult as Record<string, unknown>;
}

/**
 * Get episode status
 */
export async function getEpisodeStatus(scriptId: string): Promise<EpStatus> {
  const script = await prisma.novelScript.findUnique({
    where: { id: scriptId },
    select: { scriptContent: true },
  });

  if (!script || !script.scriptContent) return "empty";

  const keyResourceCount = await prisma.keyResource.count({
    where: { scopeType: "script", scopeId: scriptId, currentVersion: { gt: 0 } },
  });
  return keyResourceCount > 0 ? "has_resources" : "uploaded";
}

/**
 * Get episode metadata (for MCP layer)
 * Returns scriptKey and initResult
 */
export async function getEpisode(scriptId: string): Promise<{ scriptKey: string; initResult: unknown } | null> {
  const script = await prisma.novelScript.findUnique({
    where: { id: scriptId },
    select: { scriptKey: true, initResult: true },
  });
  return script;
}

/**
 * Get the previous/current/next episode source window for continuity-aware prompts.
 *
 * Example: current EP2 returns all scripts whose base key is EP1, EP2, or EP3.
 * The returned scriptContent is the original uploaded episode text used by Writer.
 */
export async function getEpisodeWindow(scriptId: string): Promise<EpisodeWindowItem[]> {
  const current = await prisma.novelScript.findUnique({
    where: { id: scriptId },
    select: { novelId: true, scriptKey: true },
  });
  if (!current) return [];

  const currentNumber = episodeNumberFromScriptKey(current.scriptKey);
  if (currentNumber === null) {
    const script = await prisma.novelScript.findUnique({
      where: { id: scriptId },
      select: {
        id: true,
        scriptKey: true,
        scriptName: true,
        scriptContent: true,
        initResult: true,
      },
    });
    return script
      ? [{
          scriptId: script.id,
          scriptKey: script.scriptKey,
          scriptName: script.scriptName,
          scriptContent: script.scriptContent,
          initResult: script.initResult,
          relation: "current",
        }]
      : [];
  }

  const targetNumbers = new Set([currentNumber - 1, currentNumber, currentNumber + 1]);
  const scripts = await prisma.novelScript.findMany({
    where: { novelId: current.novelId },
    select: {
      id: true,
      scriptKey: true,
      scriptName: true,
      scriptContent: true,
      initResult: true,
    },
  });

  return scripts
    .map((script) => ({
      script,
      episodeNumber: episodeNumberFromScriptKey(script.scriptKey),
    }))
    .filter((item) => item.episodeNumber !== null && targetNumbers.has(item.episodeNumber))
    .sort((a, b) => {
      const aNumber = a.episodeNumber ?? 0;
      const bNumber = b.episodeNumber ?? 0;
      if (aNumber !== bNumber) return aNumber - bNumber;
      return a.script.scriptKey.localeCompare(b.script.scriptKey);
    })
    .map((item): EpisodeWindowItem => {
      const episodeNumber = item.episodeNumber ?? currentNumber;
      const relation: EpisodeWindowItem["relation"] =
        episodeNumber < currentNumber
          ? "previous"
          : episodeNumber > currentNumber
            ? "next"
            : "current";
      return {
        scriptId: item.script.id,
        scriptKey: item.script.scriptKey,
        scriptName: item.script.scriptName,
        scriptContent: item.script.scriptContent,
        initResult: item.script.initResult,
        relation,
      };
    });
}

/**
 * Internal: Batch insert episodes from script upload
 */
export async function insertEpisodes(
  novelId: string,
  episodes: ScriptEpisode[],
): Promise<EpisodeSummary[]> {
  const created: EpisodeSummary[] = [];
  for (const episode of episodes) {
    const scriptKey = scriptKeyForEpisode(episode);

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

    created.push({
      id: script.id,
      novelId,
      scriptKey,
      scriptName: episode.output.episode_title,
      status: "uploaded",
      createdAt: script.createdAt.toISOString(),
    });
  }
  return created;
}
