/**
 * video_workflow MCP — atomic tools for video production pipeline.
 *
 * Discovery (2): list_novels, list_episodes
 * Data queries (2): get_episode, get_status
 * Novel-level image gen (2): generate_portrait, generate_scene (single/grid/hd)
 * EP-level image gen (1): generate_costume
 * Video gen (1): execute_video_shot
 *
 * All generate_* tools auto-handle key/scope/category/KeyResource/domain_resources.
 */

import { z } from "zod";
import type { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types";
import type { McpProvider, ToolContext } from "../types";
import * as novelService from "@/lib/services/novel-service";
import * as episodeService from "@/lib/services/episode-service";
import * as orchestrationService from "@/lib/services/video-workflow-orchestration-service";
import * as assetGenerationService from "@/lib/services/video-asset-generation-service";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function text(t: string): CallToolResult {
  return { content: [{ type: "text", text: t }] };
}

function json(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

/* ------------------------------------------------------------------ */
/*  Zod Schemas                                                        */
/* ------------------------------------------------------------------ */

const NovelIdParam = z.object({ novelId: z.string().min(1) });
const ScriptIdParam = z.object({ scriptId: z.string().min(1) });

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

  // --- Video Execution ---
  {
    name: "execute_video_shot",
    description:
      "Execute a single video shot end-to-end: auto-resolves reference images from definition, " +
      "always uses video_style, handles extract_tail for continuation shots. " +
      "Pass the shot data from plan_video_shots output. For continuation shots (definition has @视频1), " +
      "pass previousVideoUrl. The tool does everything else.",
    inputSchema: {
      type: "object" as const,
      properties: {
        scriptId: { type: "string", description: "Episode script DB ID" },
        key: { type: "string", description: "Shot key (e.g. 'public_1', 'branch_1_1')" },
        shotPrompt: { type: "string", description: "Shot prompt from plan_video_shots output" },
        definition: { type: "string", description: "Definition from plan_video_shots (e.g. '@图1 是 [场景X空镜]，@图2 是 [人物A立绘]')" },
        duration: { type: "number", description: "Duration in seconds (4-15)" },
        previousVideoUrl: { type: "string", description: "Previous shot's video URL (for continuation shots with @视频1). Tool auto-calls extract_tail." },
        title: { type: "string", description: "Human-readable label" },
      },
      required: ["scriptId", "key", "shotPrompt", "definition", "duration"],
    },
  },
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
    try {
      switch (name) {
        case "list_novels": {
          const novels = await novelService.listNovels();
          return json(novels);
        }

        case "list_episodes": {
          const { novelId } = NovelIdParam.parse(args);
          const episodes = await episodeService.listEpisodes(novelId);
          return json(episodes);
        }

        case "get_episode": {
          const { scriptId } = ScriptIdParam.parse(args);
          const episode = await episodeService.getEpisode(scriptId);

          if (!episode) return text(`Episode not found: ${scriptId}`);
          if (!episode.initResult) return text(`Episode ${scriptId} has no init_result data`);

          return json({ scriptKey: episode.scriptKey, ...episode.initResult as Record<string, unknown> });
        }

        case "get_status": {
          const params = orchestrationService.GetStatusParams.parse(args);
          const result = await orchestrationService.getStatus(params);
          return json(result);
        }

        case "generate_portrait": {
          const params = assetGenerationService.GeneratePortraitParams.parse(args);
          const result = await assetGenerationService.generatePortrait(params);
          return json(result);
        }

        case "update_portrait": {
          const params = assetGenerationService.GeneratePortraitParams.parse(args);
          const result = await assetGenerationService.updatePortrait(params);
          return json(result);
        }

        case "generate_scene": {
          const params = assetGenerationService.GenerateSceneParams.parse(args);
          const result = await assetGenerationService.generateScene(params);
          return json(result);
        }

        case "generate_costume": {
          const params = assetGenerationService.GenerateCostumeParams.parse(args);
          const result = await assetGenerationService.generateCostume(params);
          return json(result);
        }

        case "execute_video_shot": {
          const params = assetGenerationService.ExecuteVideoShotParams.parse(args);
          const result = await assetGenerationService.executeVideoShot(params);
          return json(result);
        }

        default:
          return text(`Unknown tool: ${name}`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return json({ status: "error", error: message });
    }
  },
};
