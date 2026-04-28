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
import * as batchTaskService from "@/lib/services/batch-generation-task-service";

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

  // --- Async Image Generation Tasks ---
  {
    name: "submit_generation_task",
    description:
      "提交异步图片生成任务。所有图片生成操作（单个或批量）都使用此接口，避免超时问题。" +
      "支持的任务类型：\n" +
      "• portrait - 生成单个角色立绘（小说级）\n" +
      "• update_portrait - 更新单个角色立绘（小说级）\n" +
      "• scene - 生成单个场景图片（小说级）\n" +
      "• costume - 生成单个角色换装图（EP 级）\n" +
      "• batch_portraits - 批量生成角色立绘（小说级）\n" +
      "• batch_scenes - 批量生成场景图片（小说级）\n" +
      "• batch_costumes - 批量生成角色换装图（EP 级）\n" +
      "返回 taskId，使用 get_task_status 查询任务状态和结果。",
    inputSchema: {
      type: "object" as const,
      properties: {
        taskType: {
          type: "string",
          enum: ["portrait", "update_portrait", "scene", "costume", "batch_portraits", "batch_scenes", "batch_costumes"],
          description: "任务类型",
        },
        params: {
          type: "object",
          description:
            "任务参数（根据 taskType 不同而不同）：\n" +
            "• portrait/update_portrait: {novelId, characterName, styleName?, prompt?, referenceUrls?, model?}\n" +
            "• scene: {novelId, sceneName, mode?, referenceUrls?, model?}\n" +
            "• costume: {scriptId, characterName, styleName?, referenceUrls?, model?}\n" +
            "• batch_portraits: {novelId, characterNames[], styleName?, model?}\n" +
            "• batch_scenes: {novelId, sceneNames[], mode?, model?}\n" +
            "• batch_costumes: {scriptId, characterNames[], styleName?, model?}",
        },
      },
      required: ["taskType", "params"],
    },
  },
  {
    name: "get_task_status",
    description:
      "查询异步任务状态和结果。返回任务的当前状态（pending/running/completed/failed）、进度、结果或错误信息。",
    inputSchema: {
      type: "object" as const,
      properties: {
        taskId: { type: "string", description: "任务 ID（由 submit_generation_task 返回）" },
      },
      required: ["taskId"],
    },
  },
  {
    name: "list_generation_tasks",
    description:
      "列出指定范围内的所有异步生成任务。用于查看小说或 EP 的所有生成任务历史。",
    inputSchema: {
      type: "object" as const,
      properties: {
        novelId: { type: "string", description: "小说 ID（查询小说级任务）" },
        scriptId: { type: "string", description: "EP script ID（查询 EP 级任务）" },
      },
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

  // --- Async Batch Generation Tasks ---
  {
    name: "submit_batch_portraits_task",
    description:
      "提交批量角色立绘生成任务（异步）。立即返回 taskId，任务在后台执行。" +
      "适用于需要生成大量角色立绘且不想等待的场景（生成时间可能长达 5 分钟）。" +
      "使用 get_batch_task_status 查询任务状态和结果。",
    inputSchema: {
      type: "object" as const,
      properties: {
        novelId: { type: "string", description: "小说 ID" },
        characterNames: { type: "array", items: { type: "string" }, description: "角色名称列表" },
        styleName: { type: "string", description: "样式预设名称" },
        model: { type: "string", description: "图片生成模型名称" },
      },
      required: ["novelId", "characterNames"],
    },
  },
  {
    name: "submit_batch_scenes_task",
    description:
      "提交批量场景图片生成任务（异步）。立即返回 taskId，任务在后台执行。" +
      "适用于需要生成大量场景图片且不想等待的场景（生成时间可能长达 5 分钟）。" +
      "使用 get_batch_task_status 查询任务状态和结果。",
    inputSchema: {
      type: "object" as const,
      properties: {
        novelId: { type: "string", description: "小说 ID" },
        sceneNames: { type: "array", items: { type: "string" }, description: "场景名称列表" },
        mode: { type: "string", enum: ["single", "grid", "hd"], description: "生成模式" },
        model: { type: "string", description: "图片生成模型名称" },
      },
      required: ["novelId", "sceneNames"],
    },
  },
  {
    name: "submit_batch_costumes_task",
    description:
      "提交批量换装图片生成任务（异步）。立即返回 taskId，任务在后台执行。" +
      "适用于 EP 初始化时需要生成所有角色换装且不想等待的场景（生成时间可能长达 5 分钟）。" +
      "使用 get_batch_task_status 查询任务状态和结果。",
    inputSchema: {
      type: "object" as const,
      properties: {
        scriptId: { type: "string", description: "Episode script DB ID" },
        characterNames: { type: "array", items: { type: "string" }, description: "角色名称列表" },
        styleName: { type: "string", description: "样式预设名称" },
        model: { type: "string", description: "图片生成模型名称" },
      },
      required: ["scriptId", "characterNames"],
    },
  },
  {
    name: "get_batch_task_status",
    description:
      "查询批量生成任务的状态和结果。返回任务状态（pending/running/completed/failed）、" +
      "进度（已完成数量/总数量）、结果（completed 时）或错误信息（failed 时）。",
    inputSchema: {
      type: "object" as const,
      properties: {
        taskId: { type: "string", description: "任务 ID（由 submit_batch_*_task 返回）" },
      },
      required: ["taskId"],
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

        case "submit_generation_task": {
          const { taskType, params } = z.object({
            taskType: z.enum(["portrait", "update_portrait", "scene", "costume", "batch_portraits", "batch_scenes", "batch_costumes"]),
            params: z.record(z.string(), z.unknown()),
          }).parse(args);

          let taskId: string = "";
          switch (taskType) {
            case "portrait": {
              const parsed = batchTaskService.SubmitPortraitParams.parse(params);
              taskId = await batchTaskService.submitPortraitTask(parsed);
              break;
            }
            case "update_portrait": {
              const parsed = batchTaskService.SubmitUpdatePortraitParams.parse(params);
              taskId = await batchTaskService.submitUpdatePortraitTask(parsed);
              break;
            }
            case "scene": {
              const parsed = batchTaskService.SubmitSceneParams.parse(params);
              taskId = await batchTaskService.submitSceneTask(parsed);
              break;
            }
            case "costume": {
              const parsed = batchTaskService.SubmitCostumeParams.parse(params);
              taskId = await batchTaskService.submitCostumeTask(parsed);
              break;
            }
            case "batch_portraits": {
              const parsed = batchTaskService.SubmitBatchPortraitsParams.parse(params);
              taskId = await batchTaskService.submitBatchPortraitsTask(parsed);
              break;
            }
            case "batch_scenes": {
              const parsed = batchTaskService.SubmitBatchScenesParams.parse(params);
              taskId = await batchTaskService.submitBatchScenesTask(parsed);
              break;
            }
            case "batch_costumes": {
              const parsed = batchTaskService.SubmitBatchCostumesParams.parse(params);
              taskId = await batchTaskService.submitBatchCostumesTask(parsed);
              break;
            }
          }
          return json({ taskId, status: "submitted" });
        }

        case "get_task_status": {
          const { taskId } = z.object({ taskId: z.string() }).parse(args);
          const result = await batchTaskService.getTaskStatus(taskId);
          if (!result) {
            return json({ status: "error", error: "Task not found" });
          }
          return json(result);
        }

        case "list_generation_tasks": {
          const { novelId, scriptId } = z.object({
            novelId: z.string().optional(),
            scriptId: z.string().optional(),
          }).parse(args);

          if (!novelId && !scriptId) {
            return json({ status: "error", error: "Either novelId or scriptId is required" });
          }

          const scopeType = novelId ? "novel" : "script";
          const scopeId = (novelId || scriptId) as string;
          const tasks = await batchTaskService.listTasks(scopeType, scopeId);
          return json(tasks);
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
