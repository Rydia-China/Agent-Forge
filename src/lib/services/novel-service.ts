/**
 * Novel Service - Pure CRUD operations for novels
 * 
 * This service only handles novel-level database operations.
 * For complex operations involving episodes and resources, use video-coordination-service.
 */

import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma";
import type { NovelSummary, NovelLevelData } from "@/lib/video/novel-types";
import type { NovelScriptUpload } from "@/lib/video/script-upload-schema";

/**
 * List all novels, ordered by creation date (newest first)
 */
export async function listNovels(): Promise<NovelSummary[]> {
  const novels = await prisma.novel.findMany({
    orderBy: { createdAt: "desc" },
  });
  return novels.map((novel: { id: string; name: string; episodeCount: number; createdAt: Date }) => ({
    id: novel.id,
    name: novel.name,
    episodeCount: novel.episodeCount,
    createdAt: novel.createdAt.toISOString(),
  }));
}

/**
 * Create a novel record only (without episodes or resources)
 * For creating a novel with script and episodes, use video-coordination-service
 */
export async function createNovelOnly(
  name: string,
  upload: NovelScriptUpload,
): Promise<{ id: string; name: string; episodeCount: number }> {
  const episodeCount = upload.episodes?.length ?? 0;
  
  const novel = await prisma.novel.create({
    data: {
      name,
      episodeCount,
      synopsis: upload.synopsis as Prisma.InputJsonValue,
      characterArcs: upload.character_arcs as Prisma.InputJsonValue,
      locationBible: upload.location_bible as Prisma.InputJsonValue,
    },
  });

  return {
    id: novel.id,
    name: novel.name,
    episodeCount: novel.episodeCount,
  };
}

/**
 * Delete a novel and its novel-scoped resources only
 * Does NOT delete episodes - caller must handle episode deletion first
 */
export async function deleteNovelOnly(novelId: string): Promise<void> {
  // Delete novel-scoped resources
  await prisma.keyResource.deleteMany({ where: { scopeType: "novel", scopeId: novelId } });
  await prisma.domainResource.deleteMany({ where: { scopeType: "novel", scopeId: novelId } });

  // Delete the novel itself (cascade deletes NovelScript via Prisma FK)
  await prisma.novel.delete({ where: { id: novelId } });
}

/**
 * Read novel-level data (character_arcs, location_bible, synopsis) from novels table
 */
export async function getNovelLevelData(novelId: string): Promise<NovelLevelData> {
  const novel = await prisma.novel.findUnique({
    where: { id: novelId },
    select: { characterArcs: true, locationBible: true, synopsis: true },
  });

  if (!novel) return { characterArcs: [], locationBible: [], synopsis: null };

  const characterArcs = novel.characterArcs;
  const locationBible = novel.locationBible;
  const synopsis = novel.synopsis;

  return {
    characterArcs: Array.isArray(characterArcs) ? characterArcs as Array<Record<string, unknown>> : [],
    locationBible: Array.isArray(locationBible) ? locationBible as Array<Record<string, unknown>> : [],
    synopsis: synopsis && !Array.isArray(synopsis) ? synopsis as Record<string, unknown> : null,
  };
}
