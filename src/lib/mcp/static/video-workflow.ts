/**
 * video_workflow MCP — atomic tools for video production pipeline.
 *
 * Discovery (2): list_novels, list_episodes
 * Data queries (2): get_episode, get_status
 * Novel-level image gen (2): generate_portrait, generate_scene
 * EP-level image gen (1): generate_costume
 * Video gen (3): generate_video, extract_tail, concat_clips
 *
 * All generate_* tools auto-handle key/scope/category/KeyResource/domain_resources.
 */

import { z } from "zod";
import type { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types";
import type { McpProvider, ToolContext } from "../types";
import { bizPool } from "@/lib/biz-db";
import { resolveTable, GLOBAL_USER } from "@/lib/biz-db-namespace";
import { ensureVideoSchema } from "@/lib/video/schema";
import * as keyResourceService from "@/lib/services/key-resource-service";
import { generateVideo as seedanceGenerate } from "@/lib/services/seedance-client";
import { prisma } from "@/lib/db";
import {
  getRunningEpExecutorTasks,
  getRunningExecutorTasks,
} from "@/lib/video/status-service";
import { getNovelLevelData } from "@/lib/services/video-workflow-service";
import { extractVideoSegment, concatVideos } from "@/lib/services/video-process-service";
import * as ossService from "@/lib/services/oss-service";
import * as stylePresetService from "@/lib/services/style-preset-service";
import {
  langfuseFetch,
  compileTemplate,
  extractTemplate,
  PromptDetailSchema,
} from "./langfuse-helpers";
import { skillTools, handleSkillTool } from "../skill-protocol";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function text(t: string): CallToolResult {
  return { content: [{ type: "text", text: t }] };
}

function json(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

async function physical(logicalName: string): Promise<string> {
  await ensureVideoSchema();
  const resolved = await resolveTable(GLOBAL_USER, logicalName);
  if (!resolved) throw new Error(`Table "${logicalName}" not found`);
  return resolved.physicalName;
}

/** Safely parse JSONB that pg may return as string or object. */
function parseJsonb(val: unknown): Record<string, unknown> | null {
  if (val == null) return null;
  if (typeof val === "object" && !Array.isArray(val)) return val as Record<string, unknown>;
  if (typeof val === "string") {
    try { return JSON.parse(val) as Record<string, unknown>; } catch { return null; }
  }
  return null;
}

/**
 * Fetch a Langfuse prompt template and compile it with variables.
 * Throws if Langfuse is unavailable or the prompt doesn't exist.
 */
async function compileLangfuse(
  promptName: string,
  variables: Record<string, string>,
): Promise<string> {
  const raw = await langfuseFetch(
    `/api/public/v2/prompts/${encodeURIComponent(promptName)}`,
  );
  const parsed = PromptDetailSchema.parse(raw);
  const template = extractTemplate(parsed);
  return compileTemplate(template, variables);
}

/**
 * Resolve style prompt from DB style preset.
 * styleId is required — style presets live exclusively in DB.
 */
async function resolveStyle(
  styleId: string | undefined,
): Promise<{ stylePrompt: string; styleRefUrl: string | null }> {
  if (!styleId) throw new Error("styleId is required — style presets are managed in DB, not Langfuse");
  const preset = await stylePresetService.getById(styleId);
  if (!preset) throw new Error(`Style preset not found: ${styleId}`);
  return { stylePrompt: preset.prompt, styleRefUrl: preset.referenceImageUrl };
}

/** Generate an image, persist to KeyResource (single source of truth). */
async function generateAndPersistImage(
  scopeType: string,
  scopeId: string,
  key: string,
  category: string,
  prompt: string,
  title: string,
  refUrls?: string[],
): Promise<{ status: string; key: string; keyResourceId: string; imageUrl: string; version: number }> {
  const gen = await keyResourceService.generateImage({
    scopeType,
    scopeId,
    key,
    prompt,
    refUrls,
  });

  // Set category + title on KeyResource (single source for UI grouping)
  await prisma.keyResource.update({
    where: { id: gen.id },
    data: { category, title },
  });

  return {
    status: "ok",
    key: gen.key,
    keyResourceId: gen.id,
    imageUrl: gen.imageUrl,
    version: gen.version,
  };
}

/* ------------------------------------------------------------------ */
/*  Zod Schemas                                                        */
/* ------------------------------------------------------------------ */

const NovelIdParam = z.object({ novelId: z.string().min(1) });
const ScriptIdParam = z.object({ scriptId: z.string().min(1) });

const GeneratePortraitParams = z.object({
  novelId: z.string().min(1),
  characterName: z.string().min(1),
  prompt: z.string().optional(),
  referenceUrls: z.array(z.string().url()).optional(),
  styleId: z.string().min(1).optional(),
});

const GenerateSceneParams = z.object({
  novelId: z.string().min(1),
  sceneName: z.string().min(1),
  prompt: z.string().optional(),
  referenceUrls: z.array(z.string().url()).optional(),
  styleId: z.string().min(1).optional(),
});

const GenerateCostumeParams = z.object({
  scriptId: z.string().min(1),
  characterName: z.string().min(1),
  referenceUrls: z.array(z.string().url()).optional(),
  styleId: z.string().min(1).optional(),
});

const GenerateVideoParams = z.object({
  scriptId: z.string().min(1),
  key: z.string().min(1),
  clipDescription: z.string().min(1),
  duration: z.number().min(4).max(15).optional(),
  sourceImageUrl: z.string().url().optional(),
  sourceVideoUrls: z.array(z.string().url()).optional(),
  title: z.string().optional(),
  prompt: z.string().optional(),
  styleId: z.string().min(1).optional(),
});

const ExtractTailParams = z.object({
  sourceVideoUrl: z.string().url(),
  seconds: z.number().min(1).max(10).default(5),
});

const ConcatClipsParams = z.object({
  scriptId: z.string().min(1),
  key: z.string().min(1),
  clipUrls: z.array(z.string().url()).min(1),
  title: z.string().optional(),
});

const GetStatusParams = z.object({
  scriptId: z.string().min(1).optional(),
  novelId: z.string().min(1).optional(),
  mediaType: z.enum(["video", "image", "json"]).optional(),
  keyPattern: z.string().optional(),
}).refine(
  (d) => d.scriptId || d.novelId,
  { message: "At least one of scriptId or novelId is required" },
);

/* ------------------------------------------------------------------ */
/*  Tool Definitions                                                   */
/* ------------------------------------------------------------------ */

const TOOLS: Tool[] = [
  // --- Discovery ---
  {
    name: "list_novels",
    description:
      "List all novels in the system. Returns [{id, name, episodeCount, createdAt}]. " +
      "Use this as the entry point to discover available novels.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "list_episodes",
    description:
      "List all episodes for a given novel. Returns [{scriptId, scriptKey, scriptName, createdAt}]. " +
      "Use after list_novels to discover available episodes.",
    inputSchema: {
      type: "object" as const,
      properties: {
        novelId: { type: "string", description: "Novel ID" },
      },
      required: ["novelId"],
    },
  },

  // --- Data Queries ---
  {
    name: "get_episode",
    description:
      "Get full episode data (characters, outfits, scene_locations, pre_choice_script, " +
      "choice_node, post_choice_outcomes). Returns the complete init_result JSON.",
    inputSchema: {
      type: "object" as const,
      properties: {
        scriptId: { type: "string", description: "Episode script DB ID" },
      },
      required: ["scriptId"],
    },
  },
  {
    name: "get_status",
    description:
      "Unified status & resource query. Returns identity, ALL generated resources with URLs, " +
      "progress summary (portraits/scenes/costumes/videos done/total), and running async tasks. " +
      "Pass scriptId for EP-level detail (auto-resolves novelId, includes novel + EP resources). " +
      "Pass novelId alone for novel-wide overview (all EPs included). " +
      "Use mediaType/keyPattern to filter resources (e.g. mediaType='video', keyPattern='clip_1').",
    inputSchema: {
      type: "object" as const,
      properties: {
        scriptId: { type: "string", description: "Episode script DB ID — queries script + novel scopes" },
        novelId: { type: "string", description: "Novel ID — queries all scopes for this novel" },
        mediaType: { type: "string", enum: ["video", "image", "json"], description: "Filter resources by media type" },
        keyPattern: { type: "string", description: "Substring filter on resource key" },
      },
    },
  },

  // --- Novel-level Image Gen ---
  {
    name: "generate_portrait",
    description:
      "Generate a character portrait (novel-level). DO NOT pass prompt — the tool auto-reads " +
      "character_arcs from DB and compiles with style template. " +
      "Pass styleId to use a local style preset (recommended), otherwise falls back to Langfuse. " +
      "Only pass novelId + characterName (+ styleId). Auto-handles key/scope/category/persistence.",
    inputSchema: {
      type: "object" as const,
      properties: {
        novelId: { type: "string", description: "Novel ID" },
        characterName: { type: "string", description: "Character name (exact match from JSON)" },
        styleId: { type: "string", description: "Style preset ID. When provided, uses local style words + optional reference image instead of Langfuse." },
        prompt: { type: "string", description: "Override prompt. Only for manual override in exceptional cases." },
        referenceUrls: { type: "array", items: { type: "string" }, description: "Optional reference image URLs" },
      },
      required: ["novelId", "characterName"],
    },
  },
  {
    name: "generate_scene",
    description:
      "Generate a scene location image (novel-level). DO NOT pass prompt — the tool auto-reads " +
      "visual_prompt from location_bible and compiles with style template. " +
      "Pass styleId to use a local style preset (recommended), otherwise falls back to Langfuse. " +
      "Only pass novelId + sceneName (+ styleId). Auto-handles key/scope/category/persistence.",
    inputSchema: {
      type: "object" as const,
      properties: {
        novelId: { type: "string", description: "Novel ID" },
        sceneName: { type: "string", description: "Scene name in Chinese (e.g. '银月领地 豪宅 厨房')" },
        styleId: { type: "string", description: "Style preset ID. When provided, uses local style words + optional reference image instead of Langfuse." },
        prompt: { type: "string", description: "Override prompt. Only for manual override in exceptional cases." },
        referenceUrls: { type: "array", items: { type: "string" }, description: "Optional reference image URLs" },
      },
      required: ["novelId", "sceneName"],
    },
  },

  // --- EP-level Image Gen ---
  {
    name: "generate_costume",
    description:
      "Generate a character costume image for a specific episode. " +
      "Auto-reads character_outfits from DB, compiles with style template, and uses the character's portrait as reference. " +
      "Only pass scriptId + characterName + styleId. Auto-handles prompt/reference/key/scope/category/persistence.",
    inputSchema: {
      type: "object" as const,
      properties: {
        scriptId: { type: "string", description: "Episode script DB ID" },
        characterName: { type: "string", description: "Character name" },
        styleId: { type: "string", description: "Style preset ID. Uses local style words + optional reference image." },
        referenceUrls: { type: "array", items: { type: "string" }, description: "Optional additional reference image URLs" },
      },
      required: ["scriptId", "characterName"],
    },
  },

  // --- Video Gen ---
  {
    name: "generate_video",
    description:
      "Generate a ≤15s video clip via Seedance. DO NOT pass prompt — the tool auto-reads " +
      "scene images + costume images from DB, builds reference_info, and compiles the prompt. " +
      "Pass styleId to use a local style preset (recommended), otherwise falls back to Langfuse. " +
      "Only pass scriptId + key + clipDescription (+ styleId). " +
      "Pass sourceImageUrl for image-to-video, sourceVideoUrls for continuation (multimodal). " +
      "Auto-handles reference collection / prompt compilation / persistence.",
    inputSchema: {
      type: "object" as const,
      properties: {
        scriptId: { type: "string", description: "Episode script DB ID (scope)" },
        key: { type: "string", description: "Unique key for this video clip (e.g. 'pre_choice_clip_1')" },
        clipDescription: { type: "string", description: "Clip description from planning result" },
        styleId: { type: "string", description: "Style preset ID. When provided, uses local style words + optional reference image instead of Langfuse." },
        duration: { type: "number", description: "Duration in seconds (4-15, default 5)" },
        sourceImageUrl: { type: "string", description: "Source image for image-to-video (first_frame mode)" },
        sourceVideoUrls: { type: "array", items: { type: "string" }, description: "Source videos for continuation (multimodal mode)" },
        title: { type: "string", description: "Human-readable label" },
        prompt: { type: "string", description: "Override prompt. Only for manual override in exceptional cases." },
      },
      required: ["scriptId", "key", "clipDescription"],
    },
  },
  {
    name: "extract_tail",
    description:
      "Extract the last N seconds from a video URL. Used for video continuation — " +
      "pass the result as sourceVideoUrls to the next generate_video call. " +
      "Returns {clipUrl}. No DB persistence (transient reference clip).",
    inputSchema: {
      type: "object" as const,
      properties: {
        sourceVideoUrl: { type: "string", description: "Video URL to extract from" },
        seconds: { type: "number", description: "Seconds to extract from the end (default 5, max 10)" },
      },
      required: ["sourceVideoUrl"],
    },
  },
  {
    name: "concat_clips",
    description:
      "Concatenate multiple video clips into one final video. Clips are merged in order " +
      "via ffmpeg. Result is persisted to OSS and DB. Returns {videoUrl, keyResourceId}.",
    inputSchema: {
      type: "object" as const,
      properties: {
        scriptId: { type: "string", description: "Episode script DB ID (scope)" },
        key: { type: "string", description: "Unique key for the final merged video (e.g. 'pre_choice_final')" },
        clipUrls: { type: "array", items: { type: "string" }, description: "Ordered list of clip URLs to concatenate" },
        title: { type: "string", description: "Human-readable label" },
      },
      required: ["scriptId", "key", "clipUrls"],
    },
  },
  // Skill protocol: domain-scoped skill reading
  ...skillTools({ provider: "video_workflow" }),
];

/* ------------------------------------------------------------------ */
/*  Tool Implementations                                               */
/* ------------------------------------------------------------------ */

export const videoWorkflowMcp: McpProvider = {
  name: "video_workflow",

  async listTools(): Promise<Tool[]> {
    return TOOLS;
  },

  async callTool(
    name: string,
    args: Record<string, unknown>,
    _context?: ToolContext,
  ): Promise<CallToolResult> {
    // Skill protocol: list_skills + get_skill (video_workflow-scoped)
    const skillResult = handleSkillTool(name, args, { provider: "video_workflow" });
    if (skillResult) return skillResult;

    switch (name) {
      /* ------------------------------------------------------------ */
      /*  list_novels                                                  */
      /* ------------------------------------------------------------ */
      case "list_novels": {
        const tNovels = await physical("novels");
        const { rows } = await bizPool.query(
          `SELECT id, name, episode_count, created_at FROM "${tNovels}" ORDER BY created_at DESC`,
        );
        return json(
          (rows as Array<{ id: string; name: string; episode_count: number; created_at: Date }>).map((r) => ({
            id: r.id,
            name: r.name,
            episodeCount: r.episode_count ?? 0,
            createdAt: r.created_at,
          })),
        );
      }

      /* ------------------------------------------------------------ */
      /*  list_episodes                                                */
      /* ------------------------------------------------------------ */
      case "list_episodes": {
        const { novelId } = NovelIdParam.parse(args);
        const tScriptsLE = await physical("novel_scripts");
        const { rows } = await bizPool.query(
          `SELECT id, script_key, script_name, created_at FROM "${tScriptsLE}" WHERE novel_id = $1 ORDER BY script_key`,
          [novelId],
        );
        return json(
          (rows as Array<{ id: string; script_key: string; script_name: string | null; created_at: Date }>).map((r) => ({
            scriptId: r.id,
            scriptKey: r.script_key,
            scriptName: r.script_name,
            createdAt: r.created_at,
          })),
        );
      }

      /* ------------------------------------------------------------ */
      /*  get_episode                                                  */
      /* ------------------------------------------------------------ */
      case "get_episode": {
        const { scriptId } = ScriptIdParam.parse(args);
        const tScripts = await physical("novel_scripts");

        const { rows } = await bizPool.query(
          `SELECT script_key, init_result FROM "${tScripts}" WHERE id = $1 LIMIT 1`,
          [scriptId],
        );

        const row = rows[0] as { script_key: string; init_result: unknown } | undefined;
        if (!row) return text(`Episode not found: ${scriptId}`);

        const ir = parseJsonb(row.init_result);
        if (!ir) return text(`Episode ${scriptId} has no init_result data`);

        return json({ scriptKey: row.script_key, ...ir });
      }

      /* ------------------------------------------------------------ */
      /*  get_status (unified)                                         */
      /* ------------------------------------------------------------ */
      case "get_status": {
        const { scriptId, novelId: explicitNovelId, mediaType, keyPattern } =
          GetStatusParams.parse(args);

        // 1. Resolve identity
        let novelId = explicitNovelId;
        let scriptKey: string | undefined;

        if (scriptId) {
          const tScriptsS = await physical("novel_scripts");
          const { rows: sRows } = await bizPool.query(
            `SELECT novel_id, script_key FROM "${tScriptsS}" WHERE id = $1 LIMIT 1`,
            [scriptId],
          );
          const sRow = sRows[0] as { novel_id: string; script_key: string } | undefined;
          if (!sRow) return text(`Episode not found: ${scriptId}`);
          if (!novelId) novelId = sRow.novel_id;
          scriptKey = sRow.script_key;
        }

        if (!novelId) return text("At least one of scriptId or novelId is required");

        // 2. Query KeyResources across scopes
        const mediaFilter = mediaType ? { mediaType } : {};
        const includeOpts = {
          versions: { orderBy: { version: "desc" as const }, take: 1 },
        };

        // Novel scope (portraits, scenes)
        const novelResources = await prisma.keyResource.findMany({
          where: { scopeType: "novel", scopeId: novelId, ...mediaFilter },
          include: includeOpts,
          orderBy: { createdAt: "asc" },
        });

        // Script scope (costumes, videos, session JSON)
        let scriptResources: typeof novelResources = [];
        if (scriptId) {
          scriptResources = await prisma.keyResource.findMany({
            where: {
              scopeType: { in: ["script", "session"] },
              scopeId: scriptId,
              ...mediaFilter,
            },
            include: includeOpts,
            orderBy: { createdAt: "asc" },
          });
        } else {
          // Novel-wide: include ALL EPs' resources
          const tScriptsN = await physical("novel_scripts");
          const { rows: epRows } = await bizPool.query(
            `SELECT id FROM "${tScriptsN}" WHERE novel_id = $1`,
            [novelId],
          );
          const epIds = (epRows as Array<{ id: string }>).map((r) => r.id);
          if (epIds.length > 0) {
            scriptResources = await prisma.keyResource.findMany({
              where: { scopeType: "script", scopeId: { in: epIds }, ...mediaFilter },
              include: includeOpts,
              orderBy: { createdAt: "asc" },
            });
          }
        }

        const allResources = [...novelResources, ...scriptResources];

        // 3. Map to output
        let resources = allResources.map((r) => ({
          key: r.key,
          mediaType: r.mediaType,
          url: r.versions[0]?.url ?? null,
          version: r.currentVersion,
          title: r.title,
          category: r.category,
        }));

        if (keyPattern) {
          resources = resources.filter((r) => r.key.includes(keyPattern));
        }

        // 4. Progress (computed from ALL resources, before keyPattern filter)
        const byCategory = (cat: string) => {
          const items = allResources.filter((r) => r.category === cat);
          return {
            done: items.filter((r) => r.currentVersion > 0 && r.versions[0]?.url).length,
            total: items.length,
          };
        };
        const progress = {
          portraits: byCategory("角色立绘"),
          scenes: byCategory("场景"),
          costumes: byCategory("换装"),
          videos: byCategory("视频"),
        };

        // 5. Running tasks
        const runningTasks = scriptId && scriptKey
          ? await getRunningEpExecutorTasks(novelId, scriptKey)
          : await getRunningExecutorTasks(novelId);

        return json({
          identity: {
            novelId,
            ...(scriptId ? { scriptId, scriptKey } : {}),
          },
          resources,
          progress,
          runningTasks: runningTasks.map((t) => ({
            id: t.id,
            status: t.status,
            instruction: t.instructionPreview,
          })),
        });
      }

      /* ------------------------------------------------------------ */
      /*  generate_portrait                                            */
      /* ------------------------------------------------------------ */
      case "generate_portrait": {
        const { novelId, characterName, prompt: explicitPrompt, referenceUrls, styleId } =
          GeneratePortraitParams.parse(args);

        let prompt = explicitPrompt;
        let styleRefUrl: string | null = null;
        if (!prompt) {
          // Auto-read from novel-level character_arcs
          const { characterArcs } = await getNovelLevelData(novelId);
          const arc = characterArcs.find((a) => String(a.name) === characterName);
          if (!arc) return text(`No character arc found for "${characterName}" in novel ${novelId}`);

          // 1. Resolve style words from DB preset
          const style = await resolveStyle(styleId);
          styleRefUrl = style.styleRefUrl;

          // 2. Build demographics from character arc fields
          const demoParts: string[] = [];
          if (arc.gender) demoParts.push(String(arc.gender));
          if (arc.age) demoParts.push(String(arc.age));
          if (arc.appearance) demoParts.push(String(arc.appearance));
          if (arc.personality) demoParts.push(String(arc.personality));
          if (arc.socialStatus) demoParts.push(String(arc.socialStatus));
          const demographics = demoParts.join(", ");
          if (!demographics) return text(`Character arc for "${characterName}" has no visual description`);

          // 3. Compile final portrait prompt: {{stylePrompt}}, demographics: {{demographics}}
          prompt = await compileLangfuse("common__portrait__image", {
            stylePrompt: style.stylePrompt,
            demographics,
          });
        }

        // Prepend style reference image if present
        const finalRefUrls = styleRefUrl
          ? [styleRefUrl, ...(referenceUrls ?? [])]
          : referenceUrls;

        const key = `char_${characterName.toLowerCase().replace(/\s+/g, "_")}_portrait`;
        const result = await generateAndPersistImage(
          "novel", novelId, key, "角色立绘", prompt, characterName, finalRefUrls,
        );
        return json(result);
      }

      /* ------------------------------------------------------------ */
      /*  generate_scene                                               */
      /* ------------------------------------------------------------ */
      case "generate_scene": {
        const { novelId, sceneName, prompt: explicitPrompt, referenceUrls, styleId } =
          GenerateSceneParams.parse(args);

        let prompt = explicitPrompt;
        let styleRefUrl: string | null = null;
        if (!prompt) {
          // Auto-read visual_prompt from novel-level location_bible
          const { locationBible } = await getNovelLevelData(novelId);
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
          if (!visualPrompt) return text(`No visual_prompt found for scene "${sceneName}" in novel ${novelId}`);

          // 1. Resolve style words from DB preset
          const style = await resolveStyle(styleId);
          styleRefUrl = style.styleRefUrl;

          // 2. Compile final scene prompt: {{style}},{{scenePrompt}}
          prompt = await compileLangfuse("common__gen_scenery_shot__image", {
            style: style.stylePrompt,
            scenePrompt: visualPrompt,
          });
        }

        // Prepend style reference image if present
        const finalRefUrls = styleRefUrl
          ? [styleRefUrl, ...(referenceUrls ?? [])]
          : referenceUrls;

        const key = `scene_${sceneName.replace(/\s+/g, "_")}`;
        const result = await generateAndPersistImage(
          "novel", novelId, key, "场景", prompt, sceneName, finalRefUrls,
        );
        return json(result);
      }

      /* ------------------------------------------------------------ */
      /*  generate_costume                                             */
      /* ------------------------------------------------------------ */
      case "generate_costume": {
        const { scriptId, characterName, referenceUrls, styleId } =
          GenerateCostumeParams.parse(args);

        const tScripts = await physical("novel_scripts");
        const { rows: scriptRows } = await bizPool.query(
          `SELECT novel_id, init_result FROM "${tScripts}" WHERE id = $1 LIMIT 1`,
          [scriptId],
        );
        const scriptRow = scriptRows[0] as { novel_id: string; init_result: unknown } | undefined;
        if (!scriptRow) return text(`Episode not found: ${scriptId}`);

        // Auto-read outfit description from this episode's character_outfits
        const ir = parseJsonb(scriptRow.init_result);
        const outfits = ir?.character_outfits as Record<string, string> | undefined;
        const demographics = outfits?.[characterName];
        if (!demographics) return text(`No outfit for "${characterName}" in episode ${scriptId}`);

        // 1. Resolve style words from DB preset
        const style = await resolveStyle(styleId);
        const styleRefUrl = style.styleRefUrl;

        // 2. Compile costume prompt via Langfuse: {{stylePrompt}}, 用 {{appearance_desc}} 修改原本的人物立绘
        const prompt = await compileLangfuse("common__update_profile__image", {
          stylePrompt: style.stylePrompt,
          appearance_desc: demographics,
        });

        // Auto-fetch character portrait as reference (换装基于原立绘修改)
        const portraitKey = `char_${characterName.toLowerCase().replace(/\s+/g, "_")}_portrait`;
        const portrait = await prisma.keyResource.findFirst({
          where: { scopeType: "novel", scopeId: scriptRow.novel_id, key: portraitKey },
          include: { versions: { orderBy: { version: "desc" }, take: 1 } },
        });
        const portraitUrl = portrait?.versions[0]?.url ?? null;

        // Collect reference images: style ref + portrait + user-supplied
        const refParts: string[] = [];
        if (styleRefUrl) refParts.push(styleRefUrl);
        if (portraitUrl) refParts.push(portraitUrl);
        const finalRefUrls = refParts.length > 0 || referenceUrls
          ? [...refParts, ...(referenceUrls ?? [])]
          : undefined;

        const key = `costume_${characterName.toLowerCase().replace(/\s+/g, "_")}`;
        const result = await generateAndPersistImage(
          "script", scriptId, key, "换装", prompt, characterName, finalRefUrls,
        );
        return json(result);
      }

      /* ------------------------------------------------------------ */
      /*  generate_video                                               */
      /* ------------------------------------------------------------ */
      case "generate_video": {
        const params = GenerateVideoParams.parse(args);

        // --- 0. Resolve style from DB preset ---
        const style = await resolveStyle(params.styleId);

        // --- 1. Resolve novelId from scriptId ---
        const tScriptsV = await physical("novel_scripts");
        const { rows: svRows } = await bizPool.query(
          `SELECT novel_id FROM "${tScriptsV}" WHERE id = $1 LIMIT 1`,
          [params.scriptId],
        );
        const svRow = svRows[0] as { novel_id: string } | undefined;
        if (!svRow) return text(`Episode not found: ${params.scriptId}`);
        const novelId = svRow.novel_id;

        // --- 2. Collect reference images (scenes + costumes) ---
        const sceneResources = await prisma.keyResource.findMany({
          where: { scopeType: "novel", scopeId: novelId, category: "场景", currentVersion: { gt: 0 } },
          include: { versions: { orderBy: { version: "desc" }, take: 1 } },
        });
        const costumeResources = await prisma.keyResource.findMany({
          where: { scopeType: "script", scopeId: params.scriptId, category: "换装", currentVersion: { gt: 0 } },
          include: { versions: { orderBy: { version: "desc" }, take: 1 } },
        });

        const referenceImageUrls: string[] = [];
        const refInfoParts: string[] = [];
        let refIdx = 1;

        // Prepend style reference image if present
        if (style.styleRefUrl) {
          referenceImageUrls.push(style.styleRefUrl);
          refInfoParts.push(`图${refIdx}: 风格参考图 ${style.styleRefUrl}`);
          refIdx++;
        }

        for (const r of sceneResources) {
          const url = r.versions[0]?.url;
          if (url) {
            referenceImageUrls.push(url);
            refInfoParts.push(`图${refIdx}: 场景「${r.title ?? r.key}」 ${url}`);
            refIdx++;
          }
        }
        for (const r of costumeResources) {
          const url = r.versions[0]?.url;
          if (url) {
            referenceImageUrls.push(url);
            refInfoParts.push(`图${refIdx}: 角色「${r.title ?? r.key}」 ${url}`);
            refIdx++;
          }
        }

        const referenceInfo = refInfoParts.join("\n");

        // --- 3. Compile prompt (clip description + style → final wrapper) ---
        let prompt = params.prompt;
        if (!prompt) {
          // Copyright declaration — required by Jimeng's content moderation.
          // All characters are original anime characters, not real persons.
          const copyrightNotice =
            "以下人物均为版权属于我们的原创动漫人物（并非真实人物），版权所有 ©️ MOB.AI Inc";

          // Combine clip description with style words, reference info, and copyright notice
          const videoPrompt = [copyrightNotice, params.clipDescription, style.stylePrompt, referenceInfo]
            .filter(Boolean)
            .join("\n");

          // Compile final prompt wrapper
          prompt = await compileLangfuse("live2d__gen_scene__video", {
            videoPrompt,
          });
        }

        // --- 4. Build image/video URL lists for Seedance ---
        const imageUrls = [
          ...(params.sourceImageUrl ? [params.sourceImageUrl] : []),
          ...referenceImageUrls,
        ];
        const videoUrls = params.sourceVideoUrls ?? [];

        const generateType = videoUrls.length > 0
          ? "multimodal" as const
          : params.sourceImageUrl
            ? "first_frame" as const
            : "text_to_video" as const;

        // Debug context — always available for both success and failure
        const debugContext = {
          prompt,
          generateType,
          imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
          videoUrls: videoUrls.length > 0 ? videoUrls : undefined,
          referenceImageUrls,
          duration: params.duration,
        };

        let result;
        try {
          result = await seedanceGenerate({
            prompt,
            generateType,
            imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
            videoUrls: videoUrls.length > 0 ? videoUrls : undefined,
            duration: params.duration,
          });
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          return json({
            status: "error",
            error: errMsg,
            key: params.key,
            ...debugContext,
          });
        }

        // --- 5. Persist to KeyResource ---
        const kr = await keyResourceService.upsertResource(
          "script", params.scriptId, params.key, "video",
          {
            prompt,
            url: result.saveUrl,
            refUrls: [...imageUrls, ...videoUrls],
          },
        );
        await prisma.keyResource.update({
          where: { id: kr.id },
          data: { category: "视频", title: params.title ?? params.key },
        });

        return json({
          status: "ok",
          key: params.key,
          keyResourceId: kr.id,
          version: kr.version,
          videoUrl: result.saveUrl,
          timingMs: result.timingMs,
          referenceCount: referenceImageUrls.length,
          prompt,
        });
      }

      /* ------------------------------------------------------------ */
      /*  extract_tail                                                 */
      /* ------------------------------------------------------------ */
      case "extract_tail": {
        const { sourceVideoUrl, seconds } = ExtractTailParams.parse(args);

        const { writeFile: wf, readFile: rf, unlink: ul } = await import("node:fs/promises");
        const { join } = await import("node:path");
        const { tmpdir: td } = await import("node:os");
        const { randomUUID: uuid } = await import("node:crypto");
        const { path: ffmpegPath } = await import("@ffmpeg-installer/ffmpeg");
        const { execFile } = await import("node:child_process");
        const { promisify } = await import("node:util");
        const execFileAsync = promisify(execFile);

        const id = uuid();
        const tmpIn = join(td(), `tail-in-${id}.mp4`);
        const tmpOut = join(td(), `tail-out-${id}.mp4`);

        // Download source video once
        const res = await fetch(sourceVideoUrl);
        if (!res.ok) throw new Error(`下载视频失败: ${res.status}`);
        await wf(tmpIn, Buffer.from(await res.arrayBuffer()));

        try {
          // Probe duration
          let duration = 0;
          try {
            await execFileAsync(ffmpegPath, ["-i", tmpIn]);
          } catch (err: unknown) {
            const stderr = err instanceof Error && "stderr" in err
              ? (err as Error & { stderr: string }).stderr : "";
            const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/);
            if (m) {
              duration = parseInt(m[1]!) * 3600 + parseInt(m[2]!) * 60 + parseInt(m[3]!) + parseInt(m[4]!) / 100;
            }
          }

          if (duration <= 0) throw new Error("无法解析视频时长");

          // Extract tail segment directly from local file
          const startSec = Math.max(0, duration - seconds);
          await execFileAsync(ffmpegPath, [
            "-ss", String(startSec), "-i", tmpIn,
            "-c", "copy", "-y", tmpOut,
          ]);
          const tailBuffer = await rf(tmpOut);

          // Upload to OSS (transient, no KeyResource persistence)
          const filename = ossService.generateFilename("tail.mp4", "tail");
          const clipUrl = await ossService.uploadBuffer(tailBuffer, filename, "video");

          return json({ clipUrl, durationSec: duration, extractedFrom: startSec });
        } finally {
          await ul(tmpIn).catch(() => {});
          await ul(tmpOut).catch(() => {});
        }
      }

      /* ------------------------------------------------------------ */
      /*  concat_clips                                                 */
      /* ------------------------------------------------------------ */
      case "concat_clips": {
        const { scriptId, key, clipUrls, title } = ConcatClipsParams.parse(args);

        const mergedBuffer = await concatVideos(clipUrls);

        // Upload to OSS
        const filename = ossService.generateFilename("merged.mp4", "concat");
        const videoUrl = await ossService.uploadBuffer(mergedBuffer, filename, "video");

        // Persist to KeyResource (single source of truth)
        const kr = await keyResourceService.upsertResource(
          "script", scriptId, key, "video",
          {
            prompt: `Concatenated ${clipUrls.length} clips`,
            url: videoUrl,
            refUrls: clipUrls,
          },
        );
        await prisma.keyResource.update({
          where: { id: kr.id },
          data: { category: "视频", title: title ?? key },
        });

        return json({
          status: "ok",
          key,
          keyResourceId: kr.id,
          version: kr.version,
          videoUrl,
          clipCount: clipUrls.length,
        });
      }

      default:
        return text(`Unknown tool: ${name}`);
    }
  },
};
