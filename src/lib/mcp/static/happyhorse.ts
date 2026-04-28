import { z } from "zod";
import type { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types";
import type { McpProvider, ToolContext } from "../types";
import {
  callFcHappyHorseGenerate,
  type CreateTaskRequest,
} from "../../services/fc-happyhorse-client";

function text(t: string): CallToolResult {
  return { content: [{ type: "text", text: t }] };
}

function json(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

const MediaItemSchema = z.object({
  type: z.enum(["video", "reference_image"]),
  url: z.string().url(),
});

const GenerateVideoParams = z.object({
  prompt: z.string().min(1).max(2500),
  media: z.array(MediaItemSchema).min(1),
  resolution: z.enum(["1080P", "720P"]).optional(),
  ratio: z.enum(["16:9", "9:16", "1:1", "4:3", "3:4"]).optional(),
  duration: z.number().min(3).max(15).optional(),
  model: z.string().optional(),
});

export const happyhorseMcp: McpProvider = {
  name: "happyhorse",

  async listTools(): Promise<Tool[]> {
    return [
      {
        name: "happyhorse_generate_video",
        description:
          "生成 HappyHorse 视频（同步模式）。支持视频编辑和参考图风格迁移。一次调用完成：创建任务 → 轮询 → 下载 → 上传 OSS，直接返回最终视频 URL。",
        inputSchema: {
          type: "object" as const,
          properties: {
            prompt: {
              type: "string",
              description: "视频描述 prompt（最多 2500 字符）",
            },
            media: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  type: {
                    type: "string",
                    enum: ["video", "reference_image"],
                    description: "媒体类型：video（待编辑的源视频）或 reference_image（风格参考图）",
                  },
                  url: {
                    type: "string",
                    description: "媒体文件的公开 URL。视频必须为 MP4 格式。",
                  },
                },
                required: ["type", "url"],
              },
              description: "媒体数组，包含视频和/或参考图。至少需要一项。",
            },
            resolution: {
              type: "string",
              enum: ["1080P", "720P"],
              description: "视频分辨率（默认：1080P）",
            },
            ratio: {
              type: "string",
              enum: ["16:9", "9:16", "1:1", "4:3", "3:4"],
              description: "宽高比（默认：16:9）",
            },
            duration: {
              type: "number",
              description: "视频时长（秒），范围 3-15，默认 5",
            },
            model: {
              type: "string",
              description: "模型名称（默认：happyhorse-1.0-r2v）",
            },
          },
          required: ["prompt", "media"],
        },
      },
    ];
  },

  async callTool(
    name: string,
    args: Record<string, unknown>,
    _context: ToolContext,
  ): Promise<CallToolResult> {
    try {
      switch (name) {
        case "happyhorse_generate_video": {
          const params = GenerateVideoParams.parse(args);
          const request: CreateTaskRequest = {
            prompt: params.prompt,
            media: params.media,
            resolution: params.resolution,
            ratio: params.ratio,
            duration: params.duration,
            model: params.model,
          };

          const result = await callFcHappyHorseGenerate(request);
          return json({
            success: true,
            taskId: result.taskId,
            status: result.status,
            videoUrl: result.videoUrl,
            originalVideoUrl: result.originalVideoUrl,
          });
        }

        default:
          return text(`Unknown tool: ${name}`);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return json({
        success: false,
        error: errorMessage,
      });
    }
  },
};
