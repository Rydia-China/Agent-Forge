/**
 * Video Workflow Service — typed data access for the video UI.
 *
 * All queries go through biz-db via BizTableMapping resolution.
 * This is the "UI data channel" — parallel to the "Chat channel"
 * (biz_db MCP) that the LLM uses. Both read/write the same physical tables.
 */

import { bizPool } from "@/lib/biz-db";
import { resolveTable, GLOBAL_USER } from "@/lib/biz-db-namespace";
import { ensureVideoSchema } from "@/lib/video/schema";
import { prisma } from "@/lib/db";

/* ------------------------------------------------------------------ */
/*  Helper: resolve physical table name                                */
/* ------------------------------------------------------------------ */

async function physical(logicalName: string): Promise<string> {
  await ensureVideoSchema();
  const resolved = await resolveTable(GLOBAL_USER, logicalName);
  if (!resolved) throw new Error(`Video table "${logicalName}" not found in BizTableMapping`);
  return resolved.physicalName;
}

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type EpStatus = "empty" | "uploaded" | "storyboarded" | "generating" | "done";

export interface EpisodeSummary {
  id: string;
  novelId: string;
  scriptKey: string;
  scriptName: string | null;
  status: EpStatus;
  createdAt: string;
}

export interface SceneDetail {
  id: string;
  sceneIndex: number;
  sceneTitle: string | null;
  sceneDesc: string | null;
  sceneImageUrl: string | null;
}

export interface ShotDetail {
  id: string;
  sceneIndex: number;
  shotIndex: string | null;
  shotType: string | null;
  definition: string | null;
  imagePrompt: string | null;
  videoPrompt: string | null;
  imageUrl: string | null;
  videoUrl: string | null;
}

export interface StoryboardScene {
  scene: SceneDetail;
  shots: ShotDetail[];
}

export interface CharacterResource {
  id: string;
  characterName: string;
  physicalTraits: string | null;
  portraitUrl: string | null;
}

export interface CostumeResource {
  id: string;
  characterName: string;
  costumeImageUrl: string | null;
}

export interface ShotImageResource {
  id: string;
  sceneIndex: number;
  shotIndex: string | null;
  imageUrl: string;
}

export interface JsonResource {
  id: string;
  title: string;
  data: unknown;
}

export interface OtherImageResource {
  id: string;
  url: string;
  title: string | null;
}

export interface EpisodeResources {
  characters: CharacterResource[];
  costumes: CostumeResource[];
  sceneImages: SceneDetail[];
  shotImages: ShotImageResource[];
  jsonData: JsonResource[];
  otherImages: OtherImageResource[];
}

/* ------------------------------------------------------------------ */
/*  Episodes                                                           */
/* ------------------------------------------------------------------ */

export async function listEpisodes(novelId: string): Promise<EpisodeSummary[]> {
  const tScripts = await physical("novel_scripts");
  const tShots = await physical("script_shots");

  const { rows: scripts } = await bizPool.query(
    `SELECT id, novel_id, script_key, script_name,
            script_content IS NOT NULL AS has_content,
            storyboard_raw IS NOT NULL AS has_storyboard,
            created_at
     FROM "${tScripts}"
     WHERE novel_id = $1
     ORDER BY script_key`,
    [novelId],
  );

  const episodes: EpisodeSummary[] = [];
  for (const row of scripts as Array<Record<string, unknown>>) {
    const scriptId = row.id as string;

    // Count shots for status derivation
    const { rows: shotRows } = await bizPool.query(
      `SELECT shot_type, image_url IS NOT NULL AS has_image
       FROM "${tShots}"
       WHERE script_id = $1`,
      [scriptId],
    );
    const shots = shotRows as Array<{ shot_type: string | null; has_image: boolean }>;

    episodes.push({
      id: scriptId,
      novelId: row.novel_id as string,
      scriptKey: row.script_key as string,
      scriptName: row.script_name as string | null,
      status: deriveStatus(
        row.has_content as boolean,
        row.has_storyboard as boolean,
        shots,
      ),
      createdAt: String(row.created_at),
    });
  }

  return episodes;
}

function deriveStatus(
  hasContent: boolean,
  hasStoryboard: boolean,
  shots: Array<{ shot_type: string | null; has_image: boolean }>,
): EpStatus {
  if (!hasContent) return "empty";
  if (!hasStoryboard) return "uploaded";

  const nonError = shots.filter((s) => s.shot_type !== "error");
  if (nonError.length === 0) return "storyboarded";

  const withImage = nonError.filter((s) => s.has_image);
  if (withImage.length === 0) return "storyboarded";
  if (withImage.length < nonError.length) return "generating";
  return "done";
}

export async function createEpisode(
  novelId: string,
  scriptKey: string,
  scriptName: string | null,
  scriptContent: string | null,
): Promise<{ id: string }> {
  const tScripts = await physical("novel_scripts");

  const { rows } = await bizPool.query(
    `INSERT INTO "${tScripts}" (novel_id, script_key, script_name, script_content)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [novelId, scriptKey, scriptName, scriptContent],
  );

  const row = rows[0] as { id: string } | undefined;
  if (!row) throw new Error("Failed to create episode");
  return row;
}

export async function deleteEpisode(scriptId: string): Promise<void> {
  const [tScripts, tScenes, tShots, tCostumes] = await Promise.all([
    physical("novel_scripts"),
    physical("script_scenes"),
    physical("script_shots"),
    physical("script_costumes"),
  ]);

  // Look up novel_id + script_key to derive session userName
  const { rows: scriptRows } = await bizPool.query(
    `SELECT novel_id, script_key FROM "${tScripts}" WHERE id = $1 LIMIT 1`,
    [scriptId],
  );
  const scriptRow = scriptRows[0] as { novel_id: string; script_key: string } | undefined;

  // Delete biz-db data in dependency order
  await bizPool.query(`DELETE FROM "${tCostumes}" WHERE script_id = $1`, [scriptId]);
  await bizPool.query(`DELETE FROM "${tShots}" WHERE script_id = $1`, [scriptId]);
  await bizPool.query(`DELETE FROM "${tScenes}" WHERE script_id = $1`, [scriptId]);
  await bizPool.query(`DELETE FROM "${tScripts}" WHERE id = $1`, [scriptId]);

  // Cascade-delete associated sessions (messages, tasks, events, key resources)
  if (scriptRow) {
    const userName = `video:${scriptRow.novel_id}:${scriptRow.script_key}`;
    const user = await prisma.user.findUnique({ where: { name: userName } });
    if (user) {
      await prisma.chatSession.deleteMany({ where: { userId: user.id } });
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Storyboard                                                         */
/* ------------------------------------------------------------------ */

export async function getStoryboard(scriptId: string): Promise<StoryboardScene[]> {
  const tScenes = await physical("script_scenes");
  const tShots = await physical("script_shots");

  const { rows: sceneRows } = await bizPool.query(
    `SELECT id, scene_index, scene_title, scene_desc, scene_image_url
     FROM "${tScenes}"
     WHERE script_id = $1
     ORDER BY scene_index`,
    [scriptId],
  );

  const { rows: shotRows } = await bizPool.query(
    `SELECT id, scene_index, shot_index, shot_type, definition,
            image_prompt, video_prompt, image_url, video_url
     FROM "${tShots}"
     WHERE script_id = $1
     ORDER BY scene_index, shot_index`,
    [scriptId],
  );

  // Group shots by scene_index
  const shotsByScene = new Map<number, ShotDetail[]>();
  for (const raw of shotRows as Array<Record<string, unknown>>) {
    const sceneIndex = raw.scene_index as number;
    const shot: ShotDetail = {
      id: raw.id as string,
      sceneIndex,
      shotIndex: raw.shot_index as string | null,
      shotType: raw.shot_type as string | null,
      definition: raw.definition as string | null,
      imagePrompt: raw.image_prompt as string | null,
      videoPrompt: raw.video_prompt as string | null,
      imageUrl: raw.image_url as string | null,
      videoUrl: raw.video_url as string | null,
    };
    const list = shotsByScene.get(sceneIndex) ?? [];
    list.push(shot);
    shotsByScene.set(sceneIndex, list);
  }

  return (sceneRows as Array<Record<string, unknown>>).map((raw) => {
    const sceneIndex = raw.scene_index as number;
    return {
      scene: {
        id: raw.id as string,
        sceneIndex,
        sceneTitle: raw.scene_title as string | null,
        sceneDesc: raw.scene_desc as string | null,
        sceneImageUrl: raw.scene_image_url as string | null,
      },
      shots: shotsByScene.get(sceneIndex) ?? [],
    };
  });
}

/* ------------------------------------------------------------------ */
/*  Resources                                                          */
/* ------------------------------------------------------------------ */

export async function getResources(
  scriptId: string,
  novelId: string,
): Promise<EpisodeResources> {
  const [tCharacters, tCostumes, tScenes, tShots, tScripts] = await Promise.all([
    physical("novel_characters"),
    physical("script_costumes"),
    physical("script_scenes"),
    physical("script_shots"),
    physical("novel_scripts"),
  ]);

  const [charResult, costumeResult, sceneResult, shotResult, scriptResult] = await Promise.all([
    bizPool.query(
      `SELECT id, character_name, physical_traits, portrait_url, card_raw
       FROM "${tCharacters}"
       WHERE novel_id = $1
       ORDER BY created_at`,
      [novelId],
    ),
    bizPool.query(
      `SELECT id, character_name, costume_image_url
       FROM "${tCostumes}"
       WHERE script_id = $1`,
      [scriptId],
    ),
    bizPool.query(
      `SELECT id, scene_index, scene_title, scene_desc, scene_image_url
       FROM "${tScenes}"
       WHERE script_id = $1
       ORDER BY scene_index`,
      [scriptId],
    ),
    bizPool.query(
      `SELECT id, scene_index, shot_index, image_url
       FROM "${tShots}"
       WHERE script_id = $1 AND image_url IS NOT NULL
       ORDER BY scene_index, shot_index`,
      [scriptId],
    ),
    bizPool.query(
      `SELECT id, script_key, storyboard_raw
       FROM "${tScripts}"
       WHERE id = $1 LIMIT 1`,
      [scriptId],
    ),
  ]);

  // Collect fixed JSON resources from known columns
  const jsonData: JsonResource[] = [];

  // Character card_raw
  for (const r of charResult.rows as Array<Record<string, unknown>>) {
    const raw = r.card_raw as string | null;
    if (!raw) continue;
    try {
      const data: unknown = JSON.parse(raw);
      jsonData.push({
        id: `char:${r.id as string}`,
        title: (r.character_name as string) ?? "Character",
        data,
      });
    } catch { /* not valid JSON */ }
  }

  // Storyboard raw
  const scriptRow = scriptResult.rows[0] as Record<string, unknown> | undefined;
  if (scriptRow?.storyboard_raw) {
    const raw = scriptRow.storyboard_raw as string;
    try {
      const data: unknown = JSON.parse(raw);
      jsonData.push({
        id: `storyboard:${scriptRow.id as string}`,
        title: "Storyboard",
        data,
      });
    } catch { /* not valid JSON */ }
  }

  // Collect all known image URLs from domain tables
  const knownUrls = new Set<string>();
  for (const r of charResult.rows as Array<Record<string, unknown>>) {
    if (r.portrait_url) knownUrls.add(r.portrait_url as string);
  }
  for (const r of costumeResult.rows as Array<Record<string, unknown>>) {
    if (r.costume_image_url) knownUrls.add(r.costume_image_url as string);
  }
  for (const r of sceneResult.rows as Array<Record<string, unknown>>) {
    if (r.scene_image_url) knownUrls.add(r.scene_image_url as string);
  }
  for (const r of shotResult.rows as Array<Record<string, unknown>>) {
    if (r.image_url) knownUrls.add(r.image_url as string);
  }

  // Query "other" images from KeyResource via session lookup
  let otherImages: OtherImageResource[] = [];
  const scriptKey = scriptRow?.script_key as string | undefined;
  if (scriptKey) {
    const userName = `video:${novelId}:${scriptKey}`;
    const user = await prisma.user.findUnique({ where: { name: userName } });
    if (user) {
      const keyResources = await prisma.keyResource.findMany({
        where: {
          session: { userId: user.id },
          mediaType: "image",
          url: { not: null },
        },
        orderBy: { createdAt: "asc" },
      });
      otherImages = keyResources
        .filter((kr) => kr.url && !knownUrls.has(kr.url))
        .map((kr) => ({
          id: kr.id,
          url: kr.url!,
          title: kr.title,
        }));
    }
  }

  return {
    characters: (charResult.rows as Array<Record<string, unknown>>).map((r) => ({
      id: r.id as string,
      characterName: r.character_name as string,
      physicalTraits: r.physical_traits as string | null,
      portraitUrl: r.portrait_url as string | null,
    })),
    costumes: (costumeResult.rows as Array<Record<string, unknown>>).map((r) => ({
      id: r.id as string,
      characterName: r.character_name as string,
      costumeImageUrl: r.costume_image_url as string | null,
    })),
    sceneImages: (sceneResult.rows as Array<Record<string, unknown>>).map((r) => ({
      id: r.id as string,
      sceneIndex: r.scene_index as number,
      sceneTitle: r.scene_title as string | null,
      sceneDesc: r.scene_desc as string | null,
      sceneImageUrl: r.scene_image_url as string | null,
    })),
    shotImages: (shotResult.rows as Array<Record<string, unknown>>).map((r) => ({
      id: r.id as string,
      sceneIndex: r.scene_index as number,
      shotIndex: r.shot_index as string | null,
      imageUrl: r.image_url as string,
    })),
    jsonData,
    otherImages,
  };
}

/* ------------------------------------------------------------------ */
/*  Episode status (single)                                            */
/* ------------------------------------------------------------------ */

/**
 * Update a pinned JSON resource by composite id.
 * Composite id format: "char:<character_id>" or "storyboard:<script_id>"
 */
export async function updateJsonResource(
  compositeId: string,
  data: unknown,
): Promise<void> {
  const json = JSON.stringify(data);
  const sep = compositeId.indexOf(":");
  if (sep < 0) throw new Error(`Invalid JSON resource id: ${compositeId}`);
  const kind = compositeId.slice(0, sep);
  const rowId = compositeId.slice(sep + 1);

  if (kind === "char") {
    const t = await physical("novel_characters");
    await bizPool.query(`UPDATE "${t}" SET card_raw = $1 WHERE id = $2`, [json, rowId]);
  } else if (kind === "storyboard") {
    const t = await physical("novel_scripts");
    await bizPool.query(`UPDATE "${t}" SET storyboard_raw = $1 WHERE id = $2`, [json, rowId]);
  } else {
    throw new Error(`Unknown JSON resource kind: ${kind}`);
  }
}

export async function getEpisodeContent(scriptId: string): Promise<string | null> {
  const tScripts = await physical("novel_scripts");
  const { rows } = await bizPool.query(
    `SELECT script_content FROM "${tScripts}" WHERE id = $1 LIMIT 1`,
    [scriptId],
  );
  const row = rows[0] as { script_content: string | null } | undefined;
  return row?.script_content ?? null;
}

export async function getEpisodeStatus(scriptId: string): Promise<EpStatus> {
  const tScripts = await physical("novel_scripts");
  const tShots = await physical("script_shots");

  const { rows: scriptRows } = await bizPool.query(
    `SELECT script_content IS NOT NULL AS has_content,
            storyboard_raw IS NOT NULL AS has_storyboard
     FROM "${tScripts}"
     WHERE id = $1`,
    [scriptId],
  );

  const script = scriptRows[0] as { has_content: boolean; has_storyboard: boolean } | undefined;
  if (!script) return "empty";

  const { rows: shotRows } = await bizPool.query(
    `SELECT shot_type, image_url IS NOT NULL AS has_image
     FROM "${tShots}"
     WHERE script_id = $1`,
    [scriptId],
  );

  return deriveStatus(
    script.has_content,
    script.has_storyboard,
    shotRows as Array<{ shot_type: string | null; has_image: boolean }>,
  );
}
