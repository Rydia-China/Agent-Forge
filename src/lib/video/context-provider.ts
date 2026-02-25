/**
 * VideoContextProvider — structured context for video workflow LLM sessions.
 *
 * Provides the LLM with everything it needs in a single context block:
 * - Metadata (novel, script identifiers)
 * - Script content (so the LLM doesn't need to read it separately)
 * - Step completion progress
 * - Resource inventory with URLs
 */

import type { ContextProvider } from "@/lib/agent/context-provider";
import { bizPool } from "@/lib/biz-db";
import { resolveTable, GLOBAL_USER } from "@/lib/biz-db-namespace";

/* ------------------------------------------------------------------ */
/*  Config                                                             */
/* ------------------------------------------------------------------ */

export interface VideoContextConfig {
  novelId: string;
  novelName: string;
  scriptKey: string;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

async function physical(logicalName: string): Promise<string | null> {
  const resolved = await resolveTable(GLOBAL_USER, logicalName);
  return resolved?.physicalName ?? null;
}

/* ------------------------------------------------------------------ */
/*  Query types & functions                                            */
/* ------------------------------------------------------------------ */

interface ScriptFull {
  id: string;
  script_key: string;
  script_name: string | null;
  script_content: string | null;
  storyboard_raw: string | null;
}

async function queryScript(
  table: string, novelId: string, scriptKey: string,
): Promise<ScriptFull | null> {
  const { rows } = await bizPool.query(
    `SELECT id, script_key, script_name, script_content, storyboard_raw
     FROM "${table}"
     WHERE novel_id = $1 AND script_key = $2
     LIMIT 1`,
    [novelId, scriptKey],
  );
  return (rows[0] as ScriptFull | undefined) ?? null;
}

interface SceneRow {
  scene_index: number;
  scene_title: string | null;
  scene_image_url: string | null;
}

async function queryScenes(table: string, scriptId: string): Promise<SceneRow[]> {
  const { rows } = await bizPool.query(
    `SELECT scene_index, scene_title, scene_image_url
     FROM "${table}"
     WHERE script_id = $1 ORDER BY scene_index`,
    [scriptId],
  );
  return rows as SceneRow[];
}

interface ShotRow {
  shot_index: string | null;
  shot_type: string | null;
  scene_index: number;
  definition: string | null;
  image_url: string | null;
  video_url: string | null;
}

async function queryShots(table: string, scriptId: string): Promise<ShotRow[]> {
  const { rows } = await bizPool.query(
    `SELECT shot_index, shot_type, scene_index,
            definition, image_url, video_url
     FROM "${table}"
     WHERE script_id = $1 ORDER BY scene_index, shot_index`,
    [scriptId],
  );
  return rows as ShotRow[];
}

interface CostumeRow {
  character_name: string;
  costume_image_url: string | null;
}

async function queryCostumes(table: string, scriptId: string): Promise<CostumeRow[]> {
  const { rows } = await bizPool.query(
    `SELECT character_name, costume_image_url
     FROM "${table}" WHERE script_id = $1`,
    [scriptId],
  );
  return rows as CostumeRow[];
}

interface CharacterRow {
  character_name: string;
  portrait_url: string | null;
  physical_traits: string | null;
  card_raw: string | null;
}

async function queryCharacters(table: string, novelId: string): Promise<CharacterRow[]> {
  const { rows } = await bizPool.query(
    `SELECT character_name, portrait_url, physical_traits, card_raw
     FROM "${table}"
     WHERE novel_id = $1 ORDER BY created_at`,
    [novelId],
  );
  return rows as CharacterRow[];
}

/* ------------------------------------------------------------------ */
/*  Context assembly                                                   */
/* ------------------------------------------------------------------ */

function buildContext(
  config: VideoContextConfig,
  script: ScriptFull | null,
  scenes: SceneRow[],
  shots: ShotRow[],
  costumes: CostumeRow[],
  characters: CharacterRow[],
): string {
  const L: string[] = [];
  const push = (s: string) => L.push(s);

  /* ── 0. Pinned Data (editable by user, always up-to-date) ── */
  const pinnedParts: string[] = [];
  for (const c of characters) {
    if (c.card_raw) {
      pinnedParts.push(`## ${c.character_name} (Character Card)\n\`\`\`json\n${c.card_raw}\n\`\`\``);
    }
  }
  if (script?.storyboard_raw) {
    pinnedParts.push(`## Storyboard\n\`\`\`json\n${script.storyboard_raw}\n\`\`\``);
  }
  if (pinnedParts.length > 0) {
    push("# Pinned Data (editable by user \u2014 always up-to-date, never evicted)");
    push("");
    push(pinnedParts.join("\n\n"));
    push("");
    push("---");
    push("");
  }

  /* ── 1. Identifiers ── */
  push("# Video Workflow Context");
  push(`novel_name: ${config.novelName}`);
  push(`novel_id: ${config.novelId}`);
  push(`script_key: ${config.scriptKey}`);
  push(`script_db_id: ${script?.id ?? "N/A"}`);

  /* ── 2. Script content ── */
  if (script?.script_content) {
    push("");
    push("## Script Content");
    // Truncate if extremely long (>12k chars) to avoid blowing context
    const content = script.script_content;
    if (content.length > 12000) {
      push(content.slice(0, 12000));
      push(`\n... (truncated, ${content.length} chars total)`);
    } else {
      push(content);
    }
  }

  /* ── 3. Progress ── */
  push("");
  push("## Progress");

  const nonError = shots.filter((s) => s.shot_type !== "error");

  const step = (n: number, label: string, done: number, total: number | string) => {
    const mark = typeof total === "number" && done >= total && total > 0 ? "✅" : `${done}/${total}`;
    push(`${n}. ${label}: ${mark}`);
  };

  step(1, "剧本入库", script?.script_content ? 1 : 0, 1);
  step(2, "分镜脚本", script?.storyboard_raw ? 1 : 0, 1);
  if (scenes.length > 0 || nonError.length > 0) {
    push(`   scenes=${scenes.length}, shots=${nonError.length}`);
  }
  step(3, "空镜图", scenes.filter((s) => s.scene_image_url).length, scenes.length);
  step(4, "换装立绘", costumes.filter((c) => c.costume_image_url).length, costumes.length || "?");
  step(5, "分镜描述", nonError.filter((s) => s.definition).length, nonError.length);
  step(6, "分镜图", nonError.filter((s) => s.image_url).length, nonError.length);
  step(7, "视频", nonError.filter((s) => s.video_url).length, nonError.length);

  /* ── 4. Characters ── */
  if (characters.length > 0) {
    push("");
    push("## Characters");
    for (const c of characters) {
      const portrait = c.portrait_url ? `portrait=${c.portrait_url}` : "portrait=none";
      const traits = c.physical_traits ? ` traits="${c.physical_traits}"` : "";
      push(`- ${c.character_name}: ${portrait}${traits}`);
    }
  }

  /* ── 5. Costumes ── */
  if (costumes.length > 0) {
    push("");
    push("## Costumes");
    for (const c of costumes) {
      const url = c.costume_image_url ?? "none";
      push(`- ${c.character_name}: ${url}`);
    }
  }

  /* ── 6. Scenes with images ── */
  if (scenes.length > 0) {
    push("");
    push("## Scenes");
    for (const s of scenes) {
      const title = s.scene_title ?? `场景${s.scene_index}`;
      const img = s.scene_image_url ?? "none";
      push(`- [${s.scene_index}] ${title}: image=${img}`);

      // Inline shots for this scene
      const sceneShots = nonError.filter((sh) => sh.scene_index === s.scene_index);
      for (const sh of sceneShots) {
        const parts = [`#${sh.shot_index ?? "?"}`, sh.shot_type ?? ""];
        if (sh.definition) parts.push(`def="${sh.definition.slice(0, 80)}${sh.definition.length > 80 ? "..." : ""}"`);
        if (sh.image_url) parts.push(`img=${sh.image_url}`);
        if (sh.video_url) parts.push(`vid=${sh.video_url}`);
        push(`    shot ${parts.join(" ")}`);
      }
    }
  }

  return L.join("\n");
}

/* ------------------------------------------------------------------ */
/*  Provider implementation                                            */
/* ------------------------------------------------------------------ */

export class VideoContextProvider implements ContextProvider {
  constructor(private readonly config: VideoContextConfig) {}

  async build(): Promise<string> {
    const [tScripts, tScenes, tShots, tCostumes, tCharacters] = await Promise.all([
      physical("novel_scripts"),
      physical("script_scenes"),
      physical("script_shots"),
      physical("script_costumes"),
      physical("novel_characters"),
    ]);

    if (!tScripts) {
      return buildContext(this.config, null, [], [], [], []);
    }

    const script = await queryScript(tScripts, this.config.novelId, this.config.scriptKey);
    const scriptId = script?.id;

    const [scenes, shots, costumes, characters] = await Promise.all([
      scriptId && tScenes ? queryScenes(tScenes, scriptId) : Promise.resolve([]),
      scriptId && tShots ? queryShots(tShots, scriptId) : Promise.resolve([]),
      scriptId && tCostumes ? queryCostumes(tCostumes, scriptId) : Promise.resolve([]),
      tCharacters ? queryCharacters(tCharacters, this.config.novelId) : Promise.resolve([]),
    ]);

    return buildContext(this.config, script, scenes, shots, costumes, characters);
  }
}
