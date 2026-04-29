/**
 * video_workflow MCP — atomic tools for video production pipeline.
 *
 * Discovery (2): list_novels, list_episodes
 * Data queries (2): get_episode, get_status
 * Novel-level image gen (2): generate_portrait, generate_scene (single/grid/hd)
 * EP-level image gen (1): generate_costume
 * Prompt/video gen (2): save_reviewed_video_prompt, execute_video_prompt
 *
 * All generate_* tools auto-handle key/scope/category/KeyResource/domain_resources.
 */

import { z } from "zod";
import type { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types";
import type { McpProvider } from "../types";
import type { Prisma } from "@/generated/prisma";
import * as novelService from "@/lib/services/novel-service";
import * as episodeService from "@/lib/services/episode-service";
import * as orchestrationService from "@/lib/services/video-workflow-orchestration-service";
import * as assetGenerationService from "@/lib/services/video-asset-generation-service";
import * as batchTaskService from "@/lib/services/batch-generation-task-service";
import * as keyResourceService from "@/lib/services/key-resource-service";
import { setKeyResourceMetadata } from "@/lib/services/video-asset-generation-service";

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
const SaveReviewedVideoPromptParams = z.object({
  scriptId: z.string().min(1),
  key: z.string().min(1),
  prompt: z.string().min(1),
  title: z.string().optional(),
  definition: z.string().optional(),
  duration: z.number().min(1).max(60).optional(),
  refUrls: z.array(z.string().url()).optional(),
  reviewResult: z.unknown().optional(),
  data: z.unknown().optional(),
});

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

  // --- Async Batch Generation Tasks ---
  {
    name: "submit_portraits_task",
    description:
      "批量生成角色立绘（小说级）。异步执行，立即返回 taskId。" +
      "单个生成时传入长度为 1 的数组。适用于生成小说中所有角色的立绘。",
    inputSchema: {
      type: "object" as const,
      properties: {
        novelId: { type: "string", description: "小说 ID" },
        characterNames: {
          type: "array",
          items: { type: "string" },
          description: "角色名称列表（单个生成时传入长度为 1 的数组）",
          minItems: 1,
        },
        styleName: { type: "string", description: "样式预设名称（可选）" },
        model: { type: "string", description: "图片生成模型（可选）：'gemini'/'google/gemini-*' 走 Gemini FC；'gpt'/'gpt-*' 走 GPT Image FC" },
      },
      required: ["novelId", "characterNames"],
    },
  },
  {
    name: "submit_scenes_task",
    description:
      "批量生成场景图片（小说级）。异步执行，立即返回 taskId。" +
      "单个生成时传入长度为 1 的数组。适用于生成小说中所有场景的背景图。",
    inputSchema: {
      type: "object" as const,
      properties: {
        novelId: { type: "string", description: "小说 ID" },
        sceneNames: {
          type: "array",
          items: { type: "string" },
          description: "场景名称列表（单个生成时传入长度为 1 的数组）",
          minItems: 1,
        },
        mode: {
          type: "string",
          enum: ["single", "grid", "hd"],
          description: "生成模式（可选，默认 single）",
        },
        model: { type: "string", description: "图片生成模型（可选）：'gemini'/'google/gemini-*' 走 Gemini FC；'gpt'/'gpt-*' 走 GPT Image FC" },
      },
      required: ["novelId", "sceneNames"],
    },
  },
  {
    name: "submit_costumes_task",
    description:
      "批量生成角色换装图（EP 级）。异步执行，立即返回 taskId。" +
      "单个生成时传入长度为 1 的数组。适用于生成 EP 中所有角色的换装图。",
    inputSchema: {
      type: "object" as const,
      properties: {
        scriptId: { type: "string", description: "Episode script DB ID" },
        characterNames: {
          type: "array",
          items: { type: "string" },
          description: "角色名称列表（单个生成时传入长度为 1 的数组）",
          minItems: 1,
        },
        styleName: { type: "string", description: "样式预设名称（可选）" },
        model: { type: "string", description: "图片生成模型（可选）：'gemini'/'google/gemini-*' 走 Gemini FC；'gpt'/'gpt-*' 走 GPT Image FC" },
      },
      required: ["scriptId", "characterNames"],
    },
  },
  {
    name: "get_task_status",
    description:
      "查询异步任务状态和结果。返回任务的当前状态（pending/running/completed/failed）、进度、结果或错误信息。",
    inputSchema: {
      type: "object" as const,
      properties: {
        taskId: { type: "string", description: "任务 ID（由 submit_*_task 返回）" },
      },
      required: ["taskId"],
    },
  },
  {
    name: "list_tasks",
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

  // --- Prompt Persistence & Video Execution ---
  {
    name: "save_reviewed_video_prompt",
    description:
      "保存 Reviewer 已通过的视频 prompt。EP 主控在 Prompt Writer subagent 和 Reviewer subagent 都通过后调用；" +
      "只持久化 prompt/review 元数据，不生成视频。",
    inputSchema: {
      type: "object" as const,
      properties: {
        scriptId: { type: "string", description: "Episode script DB ID" },
        key: { type: "string", description: "Prompt key，例如 reviewed_prompt_main 或 clip_1_prompt" },
        prompt: { type: "string", description: "Reviewer 放行的视频生成 prompt" },
        title: { type: "string", description: "可选：UI 展示标题" },
        definition: { type: "string", description: "可选：@图N / @视频N 素材定义" },
        duration: { type: "number", description: "可选：目标视频时长" },
        refUrls: { type: "array", items: { type: "string" }, description: "可选：prompt 使用的资源 URL 列表" },
        reviewResult: { type: "object", description: "可选：Reviewer JSON 结果" },
        data: { type: "object", description: "可选：额外 JSON 元数据" },
      },
      required: ["scriptId", "key", "prompt"],
    },
  },
  {
    name: "execute_video_prompt",
    description:
      "执行一个已通过 review 的视频 prompt。只有用户明确要求生成视频时才调用；Seedance 为主路径，连续 clip 必须同时传 previousVideoUrl 和 previousFrameUrl，工具会裁上一 clip 尾段并与末帧图一起作为参照。",
    inputSchema: {
      type: "object" as const,
      properties: {
        scriptId: { type: "string", description: "Episode script DB ID" },
        key: { type: "string", description: "生成后保存的视频资源 key" },
        prompt: { type: "string", description: "Reviewer 放行的视频 prompt" },
        definition: { type: "string", description: "素材定义，例如 '@图1 是 [场景X]，@图2 是 [人物A换装图]'" },
        duration: { type: "number", description: "Duration in seconds (4-15)" },
        provider: {
          type: "string",
          enum: ["jimeng", "happyhorse"],
          description: "视频生成 provider。默认 jimeng/Seedance 主路径；happyhorse 仅作为兼容/测试路径。两种 provider 都由工具套用 video_style。",
        },
        resolution: {
          type: "string",
          enum: ["1080P", "720P"],
          description: "HappyHorse 可选分辨率",
        },
        ratio: {
          type: "string",
          enum: ["16:9", "9:16", "1:1", "4:3", "3:4"],
          description: "HappyHorse 可选宽高比",
        },
        model: { type: "string", description: "HappyHorse 可选模型名" },
        previousVideoUrl: {
          type: "string",
          description: "连续 clip 必填：上一 clip 的视频 URL。工具默认裁最后 15 秒作为 Seedance sourceVideoUrls 参照。",
        },
        previousFrameUrl: {
          type: "string",
          description: "连续 clip 必填：上一 clip 最后一帧图片 URL。工具会作为 Seedance 首帧/参考图参照传递。",
        },
        continuationTailSeconds: {
          type: "number",
          description: "可选：从上一 clip 尾部裁取的视频秒数，默认 15，范围 1-15。",
        },
        title: { type: "string", description: "Human-readable label" },
      },
      required: ["scriptId", "key", "prompt", "definition", "duration"],
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

        case "submit_portraits_task": {
          const params = batchTaskService.SubmitBatchPortraitsParams.parse(args);
          const taskId = await batchTaskService.submitBatchPortraitsTask(params);
          return json({ taskId, status: "submitted" });
        }

        case "submit_scenes_task": {
          const params = batchTaskService.SubmitBatchScenesParams.parse(args);
          const taskId = await batchTaskService.submitBatchScenesTask(params);
          return json({ taskId, status: "submitted" });
        }

        case "submit_costumes_task": {
          const params = batchTaskService.SubmitBatchCostumesParams.parse(args);
          const taskId = await batchTaskService.submitBatchCostumesTask(params);
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

        case "list_tasks": {
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

        case "save_reviewed_video_prompt": {
          const params = SaveReviewedVideoPromptParams.parse(args);
          const data = {
            ...(params.definition ? { definition: params.definition } : {}),
            ...(params.duration ? { duration: params.duration } : {}),
            ...(params.reviewResult != null ? { reviewResult: params.reviewResult } : {}),
            ...(params.data != null ? { data: params.data } : {}),
          } as Prisma.InputJsonValue;
          const resource = await keyResourceService.upsertResource(
            "script",
            params.scriptId,
            params.key,
            "json",
            {
              title: params.title ?? params.key,
              prompt: params.prompt,
              refUrls: params.refUrls ?? [],
              data,
            },
          );
          await setKeyResourceMetadata(resource.id, "视频Prompt", params.title ?? params.key);
          return json({
            status: "saved",
            key: params.key,
            keyResourceId: resource.id,
            version: resource.version,
          });
        }

        case "execute_video_prompt": {
          const params = assetGenerationService.ExecuteVideoPromptParams.parse(args);
          const result = await assetGenerationService.executeVideoPrompt(params);
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
