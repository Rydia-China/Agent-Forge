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
import * as shotPlanningService from "@/lib/services/video-shot-planning-service";

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
      "生成角色立绘（小说级）。工具会自动从数据库读取角色描述并结合样式模板生成 prompt。" +
      "通常只需传递 novelId + characterName + styleName，无需手动指定 prompt。",
    inputSchema: {
      type: "object" as const,
      properties: {
        novelId: { type: "string", description: "小说 ID" },
        characterName: { type: "string", description: "角色名称（需与 JSON 中完全匹配）" },
        styleName: { type: "string", description: "样式预设名称（例如 'portrait-style'），从数据库中按名称查找" },
        prompt: { type: "string", description: "手动覆盖 prompt。仅在需要完全自定义生成内容时使用，通常应省略此参数" },
        referenceUrls: { type: "array", items: { type: "string" }, description: "可选的参考图片 URL" },
        model: { type: "string", description: "图片生成模型名称（例如 'google/gemini-3-pro-image-preview'）。省略时使用 FC 环境默认值" },
      },
      required: ["novelId", "characterName"],
    },
  },
  {
    name: "update_portrait",
    description:
      "更新/重新生成角色立绘（小说级）。逻辑与 generate_portrait 相同，但使用独立的样式预设以便两者可以独立演化。" +
      "通常只需传递 novelId + characterName + styleName，无需手动指定 prompt。",
    inputSchema: {
      type: "object" as const,
      properties: {
        novelId: { type: "string", description: "小说 ID" },
        characterName: { type: "string", description: "角色名称（需与 JSON 中完全匹配）" },
        styleName: { type: "string", description: "样式预设名称（默认：'update_portrait_style'）" },
        prompt: { type: "string", description: "手动覆盖 prompt。仅在需要完全自定义生成内容时使用，通常应省略此参数" },
        referenceUrls: { type: "array", items: { type: "string" }, description: "可选的参考图片 URL" },
        model: { type: "string", description: "图片生成模型名称。省略时使用 FC 环境默认值" },
      },
      required: ["novelId", "characterName"],
    },
  },
  {
    name: "generate_scene",
    description:
      "生成场景位置图片（小说级）。支持三种模式：\n" +
      "• single（默认）：为单个场景生成独立图片，使用 location_style 样式\n" +
      "• grid：为父场景及其所有子场景生成统一的网格拼图，使用 location_grid_style 样式。适用于需要保持多个子场景视觉一致性的情况\n" +
      "• hd：基于父场景的 grid 图生成子场景的高清版本，使用 sub_location_style 样式。前置条件：父场景的 grid 图必须已存在\n" +
      "决策流程：首次生成单个场景 → single；需要多个子场景保持统一风格 → 先 grid 再 hd；独立场景无子场景 → single",
    inputSchema: {
      type: "object" as const,
      properties: {
        novelId: { type: "string", description: "小说 ID" },
        sceneName: { type: "string", description: "场景名称（中文），例如 '银月领地 豪宅'（grid 模式）或 '银月领地 豪宅 厨房'（hd/single 模式）" },
        mode: { type: "string", enum: ["single", "grid", "hd"], description: "生成模式：'single'（默认，独立场景）、'grid'（父场景+子场景网格）、'hd'（基于 grid 的子场景高清版）" },
        referenceUrls: { type: "array", items: { type: "string" }, description: "可选的参考图片 URL" },
        model: { type: "string", description: "图片生成模型名称。省略时使用 FC 环境默认值" },
      },
      required: ["novelId", "sceneName"],
    },
  },

  // --- Batch Novel-level Image Gen ---
  {
    name: "batch_generate_portraits",
    description:
      "批量生成多个角色立绘（小说级）。并行调用 FC 生成服务，自动从数据库读取角色描述并结合样式模板生成 prompt。" +
      "返回所有角色的生成结果（包括成功和失败）。适用于初始化小说资源或批量更新角色立绘。",
    inputSchema: {
      type: "object" as const,
      properties: {
        novelId: { type: "string", description: "小说 ID" },
        characterNames: { type: "array", items: { type: "string" }, description: "角色名称列表（需与 JSON 中完全匹配）" },
        styleName: { type: "string", description: "样式预设名称（例如 'portrait-style'），从数据库中按名称查找" },
        model: { type: "string", description: "图片生成模型名称。省略时使用 FC 环境默认值" },
      },
      required: ["novelId", "characterNames"],
    },
  },
  {
    name: "batch_generate_scenes",
    description:
      "批量生成多个场景位置图片（小说级）。并行调用 FC 生成服务，自动从数据库读取场景描述并结合样式模板生成 prompt。" +
      "返回所有场景的生成结果（包括成功和失败）。适用于初始化小说资源或批量更新场景图片。",
    inputSchema: {
      type: "object" as const,
      properties: {
        novelId: { type: "string", description: "小说 ID" },
        sceneNames: { type: "array", items: { type: "string" }, description: "场景名称列表（中文），例如 ['银月领地 豪宅', '新月领地 公墓']" },
        mode: { type: "string", enum: ["single", "grid", "hd"], description: "生成模式：'single'（默认，独立场景）、'grid'（父场景+子场景网格）、'hd'（基于 grid 的子场景高清版）" },
        model: { type: "string", description: "图片生成模型名称。省略时使用 FC 环境默认值" },
      },
      required: ["novelId", "sceneNames"],
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
  {
    name: "batch_generate_costumes",
    description:
      "批量生成多个角色换装图片（EP 级）。并行调用 FC 生成服务，自动从数据库读取 character_outfits 并结合样式模板生成 prompt。" +
      "返回所有角色的生成结果（包括成功和失败）。适用于 EP 初始化时批量生成所有角色换装。",
    inputSchema: {
      type: "object" as const,
      properties: {
        scriptId: { type: "string", description: "Episode script DB ID" },
        characterNames: { type: "array", items: { type: "string" }, description: "角色名称列表（需与 JSON 中完全匹配）" },
        styleName: { type: "string", description: "样式预设名称（例如 'costume_style'），从数据库中按名称查找" },
        model: { type: "string", description: "图片生成模型名称。省略时使用 FC 环境默认值" },
      },
      required: ["scriptId", "characterNames"],
    },
  },

  // --- Video Planning & Generation Pipeline ---
  {
    name: "plan_video_shots",
    description:
      "生成 EP 级别的所有视频镜头计划。输入当前 EP 剧本（可选前后 EP 作为上下文），" +
      "输出所有镜头的提示词计划（shotId, duration, shotPrompt, definition, assets 等）。" +
      "使用主 agent 分析剧本并生成镜头计划，遵循 video-workflow skill 规则。",
    inputSchema: {
      type: "object" as const,
      properties: {
        scriptId: { type: "string", description: "当前 Episode script DB ID" },
        prevEpisodeId: { type: "string", description: "可选：前一个 EP 的 script ID，用于上下文连贯" },
        nextEpisodeId: { type: "string", description: "可选：后一个 EP 的 script ID，用于情绪铺垫" },
      },
      required: ["scriptId"],
    },
  },
  {
    name: "review_video_shots",
    description:
      "使用 reviewer subagent 审查视频镜头提示词。按照 video-skill-reviewer 的 32 项标准检查，" +
      "返回所有问题（error/warning）和改进建议。主 agent 应根据反馈迭代改进提示词。",
    inputSchema: {
      type: "object" as const,
      properties: {
        scriptId: { type: "string", description: "Episode script DB ID" },
        shots: { type: "array", description: "待审查的镜头数组（plan_video_shots 的输出）" },
      },
      required: ["scriptId", "shots"],
    },
  },
  {
    name: "generate_video_shots",
    description:
      "完整的 EP 级视频生成管线：1) 规划镜头 2) reviewer 审查 3) 迭代改进直到通过 4) 批量生成视频。" +
      "这是一站式工具，自动处理整个流程。支持前后 EP 上下文和最大审查迭代次数配置。",
    inputSchema: {
      type: "object" as const,
      properties: {
        scriptId: { type: "string", description: "当前 Episode script DB ID" },
        prevEpisodeId: { type: "string", description: "可选：前一个 EP 的 script ID" },
        nextEpisodeId: { type: "string", description: "可选：后一个 EP 的 script ID" },
        maxReviewIterations: { type: "number", description: "最大审查迭代次数（默认 3）" },
      },
      required: ["scriptId"],
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

        case "batch_generate_portraits": {
          const params = assetGenerationService.BatchGeneratePortraitsParams.parse(args);
          const result = await assetGenerationService.batchGeneratePortraits(params);
          return json(result);
        }

        case "batch_generate_scenes": {
          const params = assetGenerationService.BatchGenerateScenesParams.parse(args);
          const result = await assetGenerationService.batchGenerateScenes(params);
          return json(result);
        }

        case "generate_costume": {
          const params = assetGenerationService.GenerateCostumeParams.parse(args);
          const result = await assetGenerationService.generateCostume(params);
          return json(result);
        }

        case "batch_generate_costumes": {
          const params = assetGenerationService.BatchGenerateCostumesParams.parse(args);
          const result = await assetGenerationService.batchGenerateCostumes(params);
          return json(result);
        }

        case "plan_video_shots": {
          const params = shotPlanningService.PlanVideoShotsParams.parse(args);
          const result = await shotPlanningService.planVideoShots(params);
          return json(result);
        }

        case "review_video_shots": {
          const params = shotPlanningService.ReviewVideoShotsParams.parse(args);
          const result = await shotPlanningService.reviewVideoShots(params);
          return json(result);
        }

        case "generate_video_shots": {
          const params = shotPlanningService.GenerateVideoShotsParams.parse(args);
          const result = await shotPlanningService.generateVideoShots(params);
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
