import { z } from "zod";
import type { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types";
import type { McpProvider, ToolContext } from "../types";
import {
  callFcHappyHorseCreate,
  callFcHappyHorseQuery,
  callFcHappyHorseWait,
  type CreateTaskRequest,
  type TaskStatus,
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

const CreateTaskParams = z.object({
  prompt: z.string().min(1).max(2500),
  media: z.array(MediaItemSchema).min(1),
  resolution: z.enum(["1080P", "720P"]).optional(),
  ratio: z.enum(["16:9", "9:16", "1:1", "4:3", "3:4"]).optional(),
  duration: z.number().min(3).max(15).optional(),
  model: z.string().optional(),
});

const QueryTaskParams = z.object({
  taskId: z.string().min(1),
});

const WaitTaskParams = z.object({
  taskId: z.string().min(1),
  maxWaitTime: z.number().min(1000).optional(),
  pollInterval: z.number().min(1000).optional(),
});

export const happyhorseMcp: McpProvider = {
  name: "happyhorse",

  async listTools(): Promise<Tool[]> {
    return [
      {
        name: "happyhorse_create_task",
        description:
          "Create a HappyHorse video generation task using DashScope API. Supports video editing with reference images. Returns taskId for status tracking.",
        inputSchema: {
          type: "object" as const,
          properties: {
            prompt: {
              type: "string",
              description: "Video description prompt (max 2500 characters)",
            },
            media: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  type: {
                    type: "string",
                    enum: ["video", "reference_image"],
                    description: "Media type: video (source video to edit) or reference_image (style reference)",
                  },
                  url: {
                    type: "string",
                    description: "Public URL of the media file. Video must be MP4 format.",
                  },
                },
                required: ["type", "url"],
              },
              description: "Media array containing video and/or reference images. At least one item required.",
            },
            resolution: {
              type: "string",
              enum: ["1080P", "720P"],
              description: "Video resolution (default: 1080P)",
            },
            ratio: {
              type: "string",
              enum: ["16:9", "9:16", "1:1", "4:3", "3:4"],
              description: "Aspect ratio (default: 16:9)",
            },
            duration: {
              type: "number",
              description: "Video duration in seconds (3-15, default: 5)",
            },
            model: {
              type: "string",
              description: "Model name (default: happyhorse-1.0-r2v)",
            },
          },
          required: ["prompt", "media"],
        },
      },
      {
        name: "happyhorse_query_task",
        description:
          "Query the status of a HappyHorse video generation task. Returns status (PENDING/RUNNING/SUCCEEDED/FAILED) and video URL when complete.",
        inputSchema: {
          type: "object" as const,
          properties: {
            taskId: {
              type: "string",
              description: "Task ID returned from create_task",
            },
          },
          required: ["taskId"],
        },
      },
      {
        name: "happyhorse_wait_task",
        description:
          "Wait for a HappyHorse task to complete with automatic polling. Returns final status and video URL. Use this for synchronous workflow.",
        inputSchema: {
          type: "object" as const,
          properties: {
            taskId: {
              type: "string",
              description: "Task ID returned from create_task",
            },
            maxWaitTime: {
              type: "number",
              description: "Maximum wait time in milliseconds (default: 300000 = 5 minutes)",
            },
            pollInterval: {
              type: "number",
              description: "Initial poll interval in milliseconds (default: auto-adjusted)",
            },
          },
          required: ["taskId"],
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
        case "happyhorse_create_task": {
          const params = CreateTaskParams.parse(args);
          const request: CreateTaskRequest = {
            prompt: params.prompt,
            media: params.media,
            resolution: params.resolution,
            ratio: params.ratio,
            duration: params.duration,
            model: params.model,
          };

          const result = await callFcHappyHorseCreate(request);
          return json({
            success: true,
            taskId: result.taskId,
            status: result.status,
            requestId: result.requestId,
          });
        }

        case "happyhorse_query_task": {
          const params = QueryTaskParams.parse(args);
          const result = await callFcHappyHorseQuery(params.taskId);
          return json({
            success: true,
            taskId: result.taskId,
            status: result.status,
            videoUrl: result.videoUrl,
            errorMessage: result.errorMessage,
            requestId: result.requestId,
          });
        }

        case "happyhorse_wait_task": {
          const params = WaitTaskParams.parse(args);
          
          const statusUpdates: TaskStatus[] = [];
          const result = await callFcHappyHorseWait(params.taskId, {
            maxWaitTime: params.maxWaitTime,
            pollInterval: params.pollInterval,
            onProgress: (status) => {
              statusUpdates.push(status);
            },
          });

          return json({
            success: true,
            taskId: result.taskId,
            status: result.status,
            videoUrl: result.videoUrl,
            errorMessage: result.errorMessage,
            requestId: result.requestId,
            statusUpdates,
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
