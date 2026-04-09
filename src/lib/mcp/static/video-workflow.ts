/**
 * video_workflow MCP — atomic tools for video production pipeline.
 *
 * Discovery (2): list_novels, list_episodes
 * Data queries (2): get_episode, get_status
 * Novel-level image gen (2): generate_portrait, generate_scene (single/grid/hd)
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
import { getNovelLevelData, analyzeLocations } from "@/lib/services/video-workflow-service";
import type { AnalyzedLocation } from "@/lib/services/video-workflow-service";
import { extractVideoSegment, concatVideos } from "@/lib/services/video-process-service";
import * as ossService from "@/lib/services/oss-service";
import * as stylePresetService from "@/lib/services/style-preset-service";
import * as langfusePromptSvc from "@/lib/services/langfuse-prompt-service";
import { compileTemplate } from "@/lib/mcp/static/langfuse-helpers";
import { runSubAgent } from "@/lib/agent/subagent";
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

/* ---- Scene structure analysis: imported from service ---- */

/**
 * Resolve style prompt from DB style preset by unique name.
 * styleName is required — style presets live exclusively in DB.
 */
async function resolveStyle(
  styleName: string | undefined,
): Promise<{ stylePrompt: string; styleRefUrl: string | null }> {
  if (!styleName) throw new Error("styleName is required — style presets are managed in DB, looked up by name");
  const preset = await stylePresetService.getByName(styleName);
  if (!preset) throw new Error(`Style preset not found: ${styleName}`);
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
  model?: string,
): Promise<{ status: string; key: string; keyResourceId: string; imageUrl: string; version: number }> {
  const gen = await keyResourceService.generateImage({
    scopeType,
    scopeId,
    key,
    prompt,
    refUrls,
    model,
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
  styleName: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
});

const GenerateSceneParams = z.object({
  novelId: z.string().min(1),
  sceneName: z.string().min(1),
  referenceUrls: z.array(z.string().url()).optional(),
  model: z.string().min(1).optional(),
  mode: z.enum(["single", "grid", "hd"]).default("single"),
});

const GenerateCostumeParams = z.object({
  scriptId: z.string().min(1),
  characterName: z.string().min(1),
  referenceUrls: z.array(z.string().url()).optional(),
  styleName: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
});

const GenerateVideoParams = z.object({
  scriptId: z.string().min(1),
  key: z.string().min(1),
  clipDescription: z.string().min(1).optional(),
  shotPrompt: z.string().min(1).optional(),
  definition: z.string().optional(),
  referenceImageUrls: z.array(z.string().url()).optional(),
  duration: z.number().min(4).max(15).optional(),
  sourceImageUrl: z.string().url().optional(),
  sourceVideoUrls: z.array(z.string().url()).optional(),
  title: z.string().optional(),
  prompt: z.string().optional(),
  styleName: z.string().min(1).optional(),
}).refine(
  (d) => d.clipDescription || d.shotPrompt,
  { message: "Either clipDescription or shotPrompt is required" },
);

const PlanVideoShotsParams = z.object({
  scriptId: z.string().min(1),
  scriptContent: z.string().min(1),
  shotType: z.string().min(1),
  model: z.string().optional(),
});

const ExecuteVideoShotParams = z.object({
  scriptId: z.string().min(1),
  key: z.string().min(1),
  shotPrompt: z.string().min(1),
  definition: z.string().min(1),
  duration: z.number().min(4).max(15),
  previousVideoUrl: z.string().url().optional(),
  title: z.string().optional(),
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
      "styleName is required — pass the StylePreset name declared in your skill. " +
      "Only pass novelId + characterName + styleName. Auto-handles key/scope/category/persistence.",
    inputSchema: {
      type: "object" as const,
      properties: {
        novelId: { type: "string", description: "Novel ID" },
        characterName: { type: "string", description: "Character name (exact match from JSON)" },
        styleName: { type: "string", description: "StylePreset name (e.g. 'portrait-style'). Looked up by unique name from DB." },
        prompt: { type: "string", description: "Override prompt. Only for manual override in exceptional cases." },
        referenceUrls: { type: "array", items: { type: "string" }, description: "Optional reference image URLs" },
        model: { type: "string", description: "Image generation model name (e.g. 'google/gemini-3-pro-image-preview'). Falls back to FC env default if omitted." },
      },
      required: ["novelId", "characterName"],
    },
  },
  {
    name: "update_portrait",
    description:
      "Update / regenerate a character portrait (novel-level). Logic is identical to generate_portrait " +
      "but uses a separate style preset so the two can diverge later. " +
      "Use styleName='update_portrait_style'. " +
      "Only pass novelId + characterName + styleName. Auto-handles key/scope/category/persistence.",
    inputSchema: {
      type: "object" as const,
      properties: {
        novelId: { type: "string", description: "Novel ID" },
        characterName: { type: "string", description: "Character name (exact match from JSON)" },
        styleName: { type: "string", description: "StylePreset name (default: 'update_portrait_style')." },
        prompt: { type: "string", description: "Override prompt. Only for manual override in exceptional cases." },
        referenceUrls: { type: "array", items: { type: "string" }, description: "Optional reference image URLs" },
        model: { type: "string", description: "Image generation model name. Falls back to FC env default if omitted." },
      },
      required: ["novelId", "characterName"],
    },
  },
  {
    name: "generate_scene",
    description:
      "Generate a scene location image (novel-level). Supports three modes:\n" +
      "• single (default): generates a single scene image from visual_prompt (style: location_style).\n" +
      "• grid: generates a unified grid image for a parent location + all sub-locations (style: location_grid_style). " +
      "Use get_status to find resources with key ending in '_grid' (url=null means not yet generated).\n" +
      "• hd: generates an HD image for a sub-location, using the parent's grid image as reference (style: sub_location_style). " +
      "The parent's grid image must already exist (run mode=grid first).\n" +
      "Style is auto-selected per mode. Only pass novelId + sceneName + mode.",
    inputSchema: {
      type: "object" as const,
      properties: {
        novelId: { type: "string", description: "Novel ID" },
        sceneName: { type: "string", description: "Scene name in Chinese (e.g. '银月领地 豪宅' for grid, '银月领地 豪宅 厨房' for hd/single)" },
        mode: { type: "string", enum: ["single", "grid", "hd"], description: "Generation mode: 'single' (default), 'grid' (parent + subs grid), 'hd' (sub-scene from grid reference)" },
        referenceUrls: { type: "array", items: { type: "string" }, description: "Optional reference image URLs" },
        model: { type: "string", description: "Image generation model name. Falls back to FC env default if omitted." },
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
      "Only pass scriptId + characterName + styleName. Auto-handles prompt/reference/key/scope/category/persistence.",
    inputSchema: {
      type: "object" as const,
      properties: {
        scriptId: { type: "string", description: "Episode script DB ID" },
        characterName: { type: "string", description: "Character name" },
        styleName: { type: "string", description: "StylePreset name. Looked up by unique name from DB." },
        referenceUrls: { type: "array", items: { type: "string" }, description: "Optional additional reference image URLs" },
        model: { type: "string", description: "Image generation model name (e.g. 'google/gemini-3-pro-image-preview'). Falls back to FC env default if omitted." },
      },
      required: ["scriptId", "characterName"],
    },
  },

  // --- Video Planning ---
  {
    name: "plan_video_shots",
    description:
      "Generate video shot plan for a script segment using the video_prompt_generator template from Langfuse. " +
      "The tool fetches the template programmatically (no LLM relay), runs a single-shot subagent (GLM-5-turbo by default), " +
      "and returns structured JSON with scenes/shots. Call once per script segment (pre_choice / each outcome). " +
      "Multiple calls can run in parallel.",
    inputSchema: {
      type: "object" as const,
      properties: {
        scriptId: { type: "string", description: "Episode script DB ID — used to persist the plan as a keyResource" },
        scriptContent: { type: "string", description: "Raw script content for this segment" },
        shotType: { type: "string", description: "Shot type label: 'public' for pre_choice, 'branch_1'/'branch_2'/... for outcomes" },
        model: { type: "string", description: "LLM model override (default: z-ai/glm-5-turbo)" },
      },
      required: ["scriptId", "scriptContent", "shotType"],
    },
  },

  {
    name: "execute_video_shot",
    description:
      "Execute a single video shot end-to-end: auto-resolves reference images from definition, " +
      "always uses video_style, handles extract_tail for continuation shots. " +
      "Pass the shot data from plan_video_shots output. For continuation shots (definition has @视飑1), " +
      "pass previousVideoUrl. The tool does everything else.",
    inputSchema: {
      type: "object" as const,
      properties: {
        scriptId: { type: "string", description: "Episode script DB ID" },
        key: { type: "string", description: "Shot key (e.g. 'public_1', 'branch_1_1')" },
        shotPrompt: { type: "string", description: "Shot prompt from plan_video_shots output" },
        definition: { type: "string", description: "Definition from plan_video_shots (e.g. '@图1 是 [场景X空镜]，@图2 是 [人物A立绘]')" },
        duration: { type: "number", description: "Duration in seconds (4-15)" },
        previousVideoUrl: { type: "string", description: "Previous shot's video URL (for continuation shots with @视飑1). Tool auto-calls extract_tail." },
        title: { type: "string", description: "Human-readable label" },
      },
      required: ["scriptId", "key", "shotPrompt", "definition", "duration"],
    },
  },

  // --- Video Gen (low-level) ---
  {
    name: "generate_video",
    description:
      "Generate a ≤15s video clip via Seedance. Two modes:\n" +
      "• **shotPrompt mode** (preferred): pass shotPrompt + referenceImageUrls. " +
      "The caller resolves definition references to URLs using get_status data. " +
      "Final prompt = copyright + shotPrompt + video_style. " +
      "Pass sourceVideoUrls for continuation (extract_tail result).\n" +
      "• **clipDescription mode** (legacy): pass clipDescription + styleName. The tool collects ALL scene/costume " +
      "images and builds referenceInfo automatically.\n" +
      "styleName is required for both modes. Pass sourceImageUrl for image-to-video (first_frame). " +
      "Auto-handles prompt compilation / persistence.",
    inputSchema: {
      type: "object" as const,
      properties: {
        scriptId: { type: "string", description: "Episode script DB ID (scope)" },
        key: { type: "string", description: "Unique key for this video clip (e.g. 'public_1')" },
        shotPrompt: { type: "string", description: "Shot prompt from video_prompt_generator output. When provided, uses shotPrompt mode." },
        referenceImageUrls: { type: "array", items: { type: "string" }, description: "Ordered reference image URLs resolved by the caller from shot definition (scene images, costume images, etc.). Used in shotPrompt mode." },
        clipDescription: { type: "string", description: "(Legacy) Clip description from clip planner. Used when shotPrompt is not provided." },
        styleName: { type: "string", description: "StylePreset name. Looked up by unique name from DB." },
        duration: { type: "number", description: "Duration in seconds (4-15, default 5)" },
        sourceImageUrl: { type: "string", description: "Source image for image-to-video (first_frame mode)" },
        sourceVideoUrls: { type: "array", items: { type: "string" }, description: "Source videos for continuation (multimodal mode). Pass extract_tail result for @视频1." },
        title: { type: "string", description: "Human-readable label" },
        prompt: { type: "string", description: "Override prompt. Only for manual override in exceptional cases." },
      },
      required: ["scriptId", "key"],
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
          versions: { orderBy: { version: "asc" as const } },
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
        const currentVersionRow = (
          resource: (typeof allResources)[number],
        ) => resource.versions.find((v) => v.version === resource.currentVersion) ?? null;

        // 3. Map to output
        let resources = allResources.map((r) => {
          const currentVer = currentVersionRow(r);
          return {
            key: r.key,
            mediaType: r.mediaType,
            url: currentVer?.url ?? null,
            ...(r.mediaType === "json" ? { data: currentVer?.data ?? null } : {}),
            version: r.currentVersion,
            title: r.title,
            category: r.category,
          };
        });

        if (keyPattern) {
          resources = resources.filter((r) => r.key.includes(keyPattern));
        }

        // 4. Progress (computed from ALL resources, before keyPattern filter)
        const byCategory = (cat: string) => {
          const items = allResources.filter((r) => r.category === cat);
          return {
            done: items.filter((r) => {
              const currentVer = currentVersionRow(r);
              if (r.mediaType === "json") return r.currentVersion > 0 && currentVer?.data != null;
              return r.currentVersion > 0 && !!currentVer?.url;
            }).length,
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
        const { novelId, characterName, prompt: explicitPrompt, referenceUrls, styleName, model } =
          GeneratePortraitParams.parse(args);

        let prompt = explicitPrompt;
        let styleRefUrl: string | null = null;
        if (!prompt) {
          // Auto-read from novel-level character_arcs
          const { characterArcs } = await getNovelLevelData(novelId);
          const arc = characterArcs.find((a) => String(a.name) === characterName);
          if (!arc) return text(`No character arc found for "${characterName}" in novel ${novelId}`);

          // 1. Resolve style words from DB preset (by name)
          const style = await resolveStyle(styleName);
          styleRefUrl = style.styleRefUrl;

          // 2. Build demographics from character arc appearance (contains gender etc.)
          const demographics = arc.appearance ? String(arc.appearance) : "";
          if (!demographics) return text(`Character arc for "${characterName}" has no appearance description`);

          // 3. Style preset IS the full prompt template — just replace variables
          prompt = compileTemplate(style.stylePrompt, { demographics });
        }

        // Prepend style reference image if present
        const finalRefUrls = styleRefUrl
          ? [styleRefUrl, ...(referenceUrls ?? [])]
          : referenceUrls;

        const key = `char_${characterName.toLowerCase().replace(/\s+/g, "_")}_portrait`;
        const result = await generateAndPersistImage(
          "novel", novelId, key, "角色立绘", prompt, characterName, finalRefUrls, model,
        );
        return json(result);
      }

      /* ------------------------------------------------------------ */
      /*  update_portrait                                               */
      /* ------------------------------------------------------------ */
      case "update_portrait": {
        // Update portrait uses update_portrait_style — template expects {{appearance_desc}}
        const { novelId, characterName, prompt: explicitPrompt, referenceUrls, styleName, model } =
          GeneratePortraitParams.parse(args);

        let prompt = explicitPrompt;
        let styleRefUrl: string | null = null;
        if (!prompt) {
          const { characterArcs } = await getNovelLevelData(novelId);
          const arc = characterArcs.find((a) => String(a.name) === characterName);
          if (!arc) return text(`No character arc found for "${characterName}" in novel ${novelId}`);

          const style = await resolveStyle(styleName);
          styleRefUrl = style.styleRefUrl;

          const appearance_desc = arc.appearance ? String(arc.appearance) : "";
          if (!appearance_desc) return text(`Character arc for "${characterName}" has no appearance description`);

          prompt = compileTemplate(style.stylePrompt, { appearance_desc });
        }

        const finalRefUrls = styleRefUrl
          ? [styleRefUrl, ...(referenceUrls ?? [])]
          : referenceUrls;

        const key = `char_${characterName.toLowerCase().replace(/\s+/g, "_")}_portrait`;
        const result = await generateAndPersistImage(
          "novel", novelId, key, "角色立绘", prompt, characterName, finalRefUrls, model,
        );
        return json(result);
      }

      /* ------------------------------------------------------------ */
      /*  generate_scene                                               */
      /* ------------------------------------------------------------ */
      case "generate_scene": {
        const { novelId, sceneName, referenceUrls, model, mode } =
          GenerateSceneParams.parse(args);

        // Style is fixed per mode — not configurable
        const styleByMode: Record<string, string> = {
          single: "location_style",
          grid: "location_grid_style",
          hd: "sub_location_style",
        };
        const style = await resolveStyle(styleByMode[mode]);
        const styleRefUrl = style.styleRefUrl;

        if (mode === "grid") {
          // --- Grid mode: unified grid image for parent + all sub-locations ---
          const { locationBible } = await getNovelLevelData(novelId);
          const analyzed = analyzeLocations(locationBible);
          const parent = analyzed.find((loc) => loc.name === sceneName);
          if (!parent) return text(`Parent location "${sceneName}" not found in location_bible`);
          if (parent.mode !== "grid") {
            return text(
              `Location "${sceneName}" has fewer than 2 real sub-locations — ` +
              `not eligible for grid mode (need ≥2). Use mode="single" instead.`,
            );
          }

          // Build gridSlots: 【格 1】parent、【格 2】sub1 ...
          const slots: string[] = [
            `【格 1】${parent.name}：${parent.visualPrompt}`,
          ];
          parent.realSubs.forEach((sub, i) => {
            slots.push(`【格 ${i + 2}】${sub.name}：${sub.visualPrompt}`);
          });

          const prompt = compileTemplate(style.stylePrompt, {
            name: sceneName,
            gridSize: String(parent.gridSize),
            gridSlots: slots.join("\n"),
          });

          const gridRefs = styleRefUrl
            ? [styleRefUrl, ...(referenceUrls ?? [])]
            : referenceUrls;

          const key = `scene_${sceneName.replace(/\s+/g, "_")}_grid`;
          const result = await generateAndPersistImage(
            "novel", novelId, key, "场景", prompt, `${sceneName} (grid)`, gridRefs, model,
          );
          return json(result);

        } else if (mode === "hd") {
          // --- HD mode: enlarge sub-scene using parent's grid image as reference ---
          const { locationBible } = await getNovelLevelData(novelId);
          const analyzed = analyzeLocations(locationBible);

          // Find which parent contains this sceneName as a sub
          let parentLoc: AnalyzedLocation | undefined;
          for (const loc of analyzed) {
            if (loc.realSubs.some((s) => s.name === sceneName)) {
              parentLoc = loc;
              break;
            }
          }
          if (!parentLoc) {
            return text(`Scene "${sceneName}" not found as a sub-location of any grid parent`);
          }

          // Look up parent's grid image from KeyResource
          const gridKey = `scene_${parentLoc.name.replace(/\s+/g, "_")}_grid`;
          const gridResource = await prisma.keyResource.findFirst({
            where: { scopeType: "novel", scopeId: novelId, key: gridKey, currentVersion: { gt: 0 } },
            include: { versions: { orderBy: { version: "desc" }, take: 1 } },
          });
          const gridUrl = gridResource?.versions[0]?.url ?? null;
          if (!gridUrl) {
            return text(
              `Grid image for parent "${parentLoc.name}" not yet generated. ` +
              `Run generate_scene with mode="grid" first.`,
            );
          }

          const prompt = compileTemplate(style.stylePrompt, { name: sceneName, sceneName });

          // Grid image as primary reference, then style ref, then user refs
          const hdRefs: string[] = [gridUrl];
          if (styleRefUrl) hdRefs.push(styleRefUrl);
          if (referenceUrls) hdRefs.push(...referenceUrls);

          const key = `scene_${sceneName.replace(/\s+/g, "_")}`;
          const result = await generateAndPersistImage(
            "novel", novelId, key, "场景", prompt, sceneName, hdRefs, model,
          );
          return json(result);

        } else {
          // --- Single mode (default): existing behavior ---
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
          if (!visualPrompt) {
            return text(`No visual_prompt found for scene "${sceneName}" in novel ${novelId}`);
          }

          const prompt = compileTemplate(style.stylePrompt, { name: sceneName, scenePrompt: visualPrompt });

          const singleRefs = styleRefUrl
            ? [styleRefUrl, ...(referenceUrls ?? [])]
            : referenceUrls;

          const key = `scene_${sceneName.replace(/\s+/g, "_")}`;
          const result = await generateAndPersistImage(
            "novel", novelId, key, "场景", prompt, sceneName, singleRefs, model,
          );
          return json(result);
        }
      }

      /* ------------------------------------------------------------ */
      /*  plan_video_shots                                              */
      /* ------------------------------------------------------------ */
      case "plan_video_shots": {
        const { scriptId: planScriptId, scriptContent, shotType, model } = PlanVideoShotsParams.parse(args);

        // 1. Fetch video_prompt_generator template from Langfuse (deterministic, no LLM)
        const templateDetail = await langfusePromptSvc.getPrompt("video_prompt_generator");
        const template = templateDetail.template;

        // 2. Build instruction = template + user message
        const userMessage = `请为以下剧本生成视频镜头脚本：\n---\n${scriptContent}\n---\n所有镜头 type 填 "${shotType}"，index 从 "1" 开始。`;
        const instruction = `${template}\n\n${userMessage}`;

        // 3. Output schema for structured result
        const outputSchema = {
          type: "object",
          properties: {
            scenes: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  scene_title: { type: "string" },
                  scene_desc: { type: "string" },
                  shots: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        index: { type: "string" },
                        type: { type: "string" },
                        duration: { type: "string" },
                        definition: { type: "string" },
                        prompt: { type: "string" },
                      },
                      required: ["index", "type", "duration", "definition", "prompt"],
                    },
                  },
                },
                required: ["scene_title", "scene_desc", "shots"],
              },
            },
          },
          required: ["scenes"],
        };

        // 4. Run single-shot subagent
        const result = await runSubAgent({
          instruction,
          model: model ?? "z-ai/glm-5-turbo",
          outputSchema,
        }, _context);

        if (result.status !== "completed") {
          return json({
            status: "error",
            shotType,
            error: result.error ?? "Subagent did not complete",
            attempts: result.attempts,
          });
        }

        // 5. Parse and persist to keyResource
        try {
          const parsed = JSON.parse(result.output) as Record<string, unknown>;
          const planKey = `shot_plan_${shotType}`;
          const kr = await keyResourceService.upsertResource(
            "script", planScriptId, planKey, "json",
            { data: parsed as import("@/generated/prisma").Prisma.InputJsonValue },
          );
          await prisma.keyResource.update({
            where: { id: kr.id },
            data: { category: "视频规划", title: `${shotType} 分镜` },
          });

          return json({
            status: "ok",
            shotType,
            keyResourceId: kr.id,
            key: planKey,
            version: kr.version,
            ...parsed,
          });
        } catch {
          return json({
            status: "ok",
            shotType,
            raw: result.output,
            warning: "Failed to parse JSON — result not persisted to keyResource",
          });
        }
      }

      /* ------------------------------------------------------------ */
      /*  execute_video_shot                                            */
      /* ------------------------------------------------------------ */
      case "execute_video_shot": {
        const shotParams = ExecuteVideoShotParams.parse(args);

        // 1. Resolve novelId from scriptId
        const tScriptsShot = await physical("novel_scripts");
        const { rows: shotRows } = await bizPool.query(
          `SELECT novel_id FROM "${tScriptsShot}" WHERE id = $1 LIMIT 1`,
          [shotParams.scriptId],
        );
        const shotRow = shotRows[0] as { novel_id: string } | undefined;
        if (!shotRow) return text(`Episode not found: ${shotParams.scriptId}`);
        const shotNovelId = shotRow.novel_id;

        // 2. Get all resources for reference matching
        const allResources = await prisma.keyResource.findMany({
          where: {
            OR: [
              { scopeType: "novel", scopeId: shotNovelId },
              { scopeType: "script", scopeId: shotParams.scriptId },
            ],
            currentVersion: { gt: 0 },
          },
          include: { versions: { orderBy: { version: "desc" }, take: 1 } },
        });

        // 3. Parse definition and resolve @图N to URLs
        const refImageUrls: string[] = [];
        const imgRefs = shotParams.definition.match(/@图\d+\s*是\s*\[([^\]]+)\]/g) ?? [];
        for (const ref of imgRefs) {
          const nameMatch = ref.match(/\[([^\]]+)\]/);
          if (!nameMatch) continue;
          const refName = nameMatch[1]!;

          // Match: resource title appears in refName, or refName appears in title
          // e.g. refName="Avery立绘" contains title="Avery", refName="Jason家别墅客厅空镜" contains title="Jason家别墅客厅"
          let matched: string | null = null;
          for (const r of allResources) {
            const url = r.versions[0]?.url;
            if (!url) continue;
            const title = r.title ?? "";
            if (!title) continue;
            if (refName.includes(title) || title.includes(refName)) {
              // Prefer 换装 over 角色立绘 for character references
              if (matched && r.category === "角色立绘") continue;
              matched = url;
              if (r.category === "换装") break;
            }
          }
          if (matched) refImageUrls.push(matched);
        }

        // 4. Resolve style (always video_style)
        const shotStyle = await resolveStyle("video_style");
        if (shotStyle.styleRefUrl) refImageUrls.unshift(shotStyle.styleRefUrl);

        // 5. Handle continuation: extract_tail if previousVideoUrl provided
        let sourceVideoUrls: string[] | undefined;
        if (shotParams.previousVideoUrl) {
          const { writeFile: wf, readFile: rf, unlink: ul } = await import("node:fs/promises");
          const { join: joinPath } = await import("node:path");
          const { tmpdir: getTmpdir } = await import("node:os");
          const { randomUUID: uuid } = await import("node:crypto");
          const { path: ffmpegPath } = await import("@ffmpeg-installer/ffmpeg");
          const { execFile } = await import("node:child_process");
          const { promisify } = await import("node:util");
          const execFileAsync = promisify(execFile);

          const tailId = uuid();
          const tmpIn = joinPath(getTmpdir(), `tail-in-${tailId}.mp4`);
          const tmpOut = joinPath(getTmpdir(), `tail-out-${tailId}.mp4`);

          const dlRes = await fetch(shotParams.previousVideoUrl);
          if (!dlRes.ok) throw new Error(`下载视频失败: ${dlRes.status}`);
          await wf(tmpIn, Buffer.from(await dlRes.arrayBuffer()));

          try {
            // Probe duration
            let videoDuration = 0;
            try {
              await execFileAsync(ffmpegPath, ["-i", tmpIn]);
            } catch (err: unknown) {
              const stderr = err instanceof Error && "stderr" in err
                ? (err as Error & { stderr: string }).stderr : "";
              const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/);
              if (m) {
                videoDuration = parseInt(m[1]!) * 3600 + parseInt(m[2]!) * 60 + parseInt(m[3]!) + parseInt(m[4]!) / 100;
              }
            }
            if (videoDuration <= 0) throw new Error("无法解析视频时长");

            const startSec = Math.max(0, videoDuration - 5);
            await execFileAsync(ffmpegPath, [
              "-ss", String(startSec), "-i", tmpIn,
              "-c", "copy", "-y", tmpOut,
            ]);
            const tailBuffer = await rf(tmpOut);
            const tailFilename = ossService.generateFilename("tail.mp4", "tail");
            const tailUrl = await ossService.uploadBuffer(tailBuffer, tailFilename, "video");
            sourceVideoUrls = [tailUrl];
          } finally {
            await ul(tmpIn).catch(() => {});
            await ul(tmpOut).catch(() => {});
          }
        }

        // 6. Compile prompt via style template
        const shotPromptCompiled = compileTemplate(shotStyle.stylePrompt, {
          definition: shotParams.definition,
          prompt: shotParams.shotPrompt,
        });

        // 7. Call Seedance
        // generateType: multimodal when continuing from video, otherwise text_to_video.
        // Reference images are passed via imageUrls but don't change the mode —
        // the prompt text (@图1 作为首帧 etc.) tells Seedance how to use them.
        const imageUrls = [...refImageUrls];
        const videoUrls = sourceVideoUrls ?? [];
        const generateType = videoUrls.length > 0
          ? "multimodal" as const
          : "text_to_video" as const;

        let seedResult;
        try {
          seedResult = await seedanceGenerate({
            prompt: shotPromptCompiled,
            generateType,
            imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
            videoUrls: videoUrls.length > 0 ? videoUrls : undefined,
            duration: shotParams.duration,
          });
        } catch (err) {
          return json({
            status: "error",
            key: shotParams.key,
            error: err instanceof Error ? err.message : String(err),
            prompt: shotPromptCompiled,
            referenceImageUrls: refImageUrls,
          });
        }

        // 8. Persist to KeyResource
        const kr = await keyResourceService.upsertResource(
          "script", shotParams.scriptId, shotParams.key, "video",
          {
            prompt: shotPromptCompiled,
            url: seedResult.saveUrl,
            refUrls: [...imageUrls, ...videoUrls],
            data: { generateType, duration: shotParams.duration },
          },
        );
        await prisma.keyResource.update({
          where: { id: kr.id },
          data: { category: "视频", title: shotParams.title ?? shotParams.key },
        });

        return json({
          status: "ok",
          key: shotParams.key,
          keyResourceId: kr.id,
          version: kr.version,
          videoUrl: seedResult.saveUrl,
          timingMs: seedResult.timingMs,
          referenceImageCount: refImageUrls.length,
          prompt: shotPromptCompiled,
        });
      }

      /* ------------------------------------------------------------ */
      /*  generate_costume                                             */
      /* ------------------------------------------------------------ */
      case "generate_costume": {
        const { scriptId, characterName, referenceUrls, styleName, model } =
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

        // 1. Resolve style words from DB preset (by name)
        const style = await resolveStyle(styleName);
        const styleRefUrl = style.styleRefUrl;

        // 2. Style preset IS the full prompt template — just replace variables
        const prompt = compileTemplate(style.stylePrompt, { appearance_desc: demographics });

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
          "script", scriptId, key, "换装", prompt, characterName, finalRefUrls, model,
        );
        return json(result);
      }

      /* ------------------------------------------------------------ */
      /*  generate_video                                               */
      /* ------------------------------------------------------------ */
      case "generate_video": {
        const params = GenerateVideoParams.parse(args);

        // --- 0. Resolve style from DB preset (by name) ---
        const style = await resolveStyle(params.styleName);

        // --- 1. Resolve novelId from scriptId ---
        const tScriptsV = await physical("novel_scripts");
        const { rows: svRows } = await bizPool.query(
          `SELECT novel_id FROM "${tScriptsV}" WHERE id = $1 LIMIT 1`,
          [params.scriptId],
        );
        const svRow = svRows[0] as { novel_id: string } | undefined;
        if (!svRow) return text(`Episode not found: ${params.scriptId}`);
        const novelId = svRow.novel_id;

        let prompt: string;
        let referenceImageUrls: string[];

        if (params.shotPrompt && !params.prompt) {
          // ============================================================
          //  shotPrompt mode: definition + style + prompt
          //  Reference URLs passed via referenceImageUrls / sourceVideoUrls
          // ============================================================
          referenceImageUrls = params.referenceImageUrls ?? [];

          // Prepend style reference image if present
          if (style.styleRefUrl) {
            referenceImageUrls.unshift(style.styleRefUrl);
          }

          prompt = compileTemplate(style.stylePrompt, {
            definition: params.definition ?? "",
            prompt: params.shotPrompt!,
          });

        } else if (params.prompt) {
          // ============================================================
          //  Explicit prompt override
          // ============================================================
          prompt = params.prompt;
          referenceImageUrls = [];

        } else {
          // ============================================================
          //  Legacy clipDescription mode
          //  Auto-collect reference image URLs from DB (style ref + scenes + costumes)
          // ============================================================
          const sceneResources = await prisma.keyResource.findMany({
            where: { scopeType: "novel", scopeId: novelId, category: "场景", currentVersion: { gt: 0 } },
            include: { versions: { orderBy: { version: "desc" }, take: 1 } },
          });
          const costumeResources = await prisma.keyResource.findMany({
            where: { scopeType: "script", scopeId: params.scriptId, category: "换装", currentVersion: { gt: 0 } },
            include: { versions: { orderBy: { version: "desc" }, take: 1 } },
          });

          referenceImageUrls = [];
          if (style.styleRefUrl) referenceImageUrls.push(style.styleRefUrl);
          for (const r of sceneResources) {
            const url = r.versions[0]?.url;
            if (url) referenceImageUrls.push(url);
          }
          for (const r of costumeResources) {
            const url = r.versions[0]?.url;
            if (url) referenceImageUrls.push(url);
          }

          prompt = compileTemplate(style.stylePrompt, {
            definition: params.definition ?? "",
            prompt: params.clipDescription ?? "",
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
            data: {
              generateType,
              imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
              videoUrls: videoUrls.length > 0 ? videoUrls : undefined,
              duration: params.duration,
            },
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
