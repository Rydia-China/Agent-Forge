import { z } from "zod";
import type { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types";
import type { McpProvider } from "../types";

function text(t: string): CallToolResult {
  return { content: [{ type: "text", text: t }] };
}

function json(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

const GenerateImageParams = z.object({
  items: z.array(
    z.object({
      prompt: z.string().min(1),
      referenceImageUrls: z.array(z.string().url()).optional(),
      model: z.enum(["gemini", "gpt"]).optional().default("gemini"),
    }),
  ).min(1),
});

const GenerateVideoParams = z.object({
  items: z.array(
    z.object({
      prompt: z.string().min(1),
      sourceImageUrl: z.string().url().optional(),
      styleName: z.string().optional(),
      referenceImageUrls: z.array(z.string().url()).optional(),
      sourceVideoUrls: z.array(z.string().url()).optional(),
    }),
  ).min(1),
});

const ConcatClipsParams = z.object({
  items: z.array(
    z.object({
      clipUrls: z.array(z.string().url()).min(1),
    }),
  ).min(1),
});

const CropVideoParams = z.object({
  items: z.array(
    z.object({
      videoUrl: z.string().url(),
      startTime: z.number().min(0),
      endTime: z.number().min(0),
    }),
  ).min(1),
});

const FcResultSchema = z.object({
  result: z.string().optional(),
  error: z.string().optional(),
});

async function callFcEndpoint(
  url: string,
  token: string,
  body: Record<string, unknown>,
  timeoutMs = 120000, // Default 2 minutes
): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const data: unknown = await res.json();
    const parsed = FcResultSchema.parse(data);

    if (!res.ok || parsed.error) {
      throw new Error(parsed.error ?? res.statusText);
    }
    if (!parsed.result) {
      throw new Error("FC returned no result");
    }

    return parsed.result;
  } finally {
    clearTimeout(timeoutId);
  }
}

export const multimodalMcp: McpProvider = {
  name: "multimodal",

  async listTools(): Promise<Tool[]> {
    return [
      {
        name: "generate_image",
        description:
          "通过 FC 生成图片。支持 Gemini 和 GPT 模型。返回每个任务的 {status, imageUrl}。",
        inputSchema: {
          type: "object" as const,
          properties: {
            items: {
              type: "array",
              description: "图片生成任务数组",
              items: {
                type: "object",
                properties: {
                  prompt: { type: "string", description: "描述要生成图片的文本 prompt" },
                  referenceImageUrls: {
                    type: "array",
                    items: { type: "string" },
                    description: "可选的参考图片 URL，用于风格/内容指导",
                  },
                  model: {
                    type: "string",
                    enum: ["gemini", "gpt"],
                    description: "图片生成模型：'gemini'（默认）或 'gpt'",
                  },
                },
                required: ["prompt"],
              },
            },
          },
          required: ["items"],
        },
      },
      {
        name: "generate_video",
        description:
          "Generate video(s) via Seedance through FC. Supports prompt mode with referenceImageUrls and sourceVideoUrls for continuation. Returns array of {status, videoUrl} for each item.",
        inputSchema: {
          type: "object" as const,
          properties: {
            items: {
              type: "array",
              description: "Array of video generation tasks",
              items: {
                type: "object",
                properties: {
                  prompt: { type: "string", description: "Motion/animation prompt describing the desired video effect" },
                  sourceImageUrl: { type: "string", description: "Optional source image URL for image-to-video (first_frame mode)" },
                  styleName: { type: "string", description: "Optional style name for video generation" },
                  referenceImageUrls: {
                    type: "array",
                    items: { type: "string" },
                    description: "Optional reference image URLs for style/content guidance",
                  },
                  sourceVideoUrls: {
                    type: "array",
                    items: { type: "string" },
                    description: "Optional source video URLs for continuation (use crop_video to extract tail segments)",
                  },
                },
                required: ["prompt"],
              },
            },
          },
          required: ["items"],
        },
      },
      {
        name: "crop_video",
        description:
          "Crop video(s) by time range via FC. Use this to extract segments (e.g., last N seconds for continuation). Returns array of {status, videoUrl} for each item.",
        inputSchema: {
          type: "object" as const,
          properties: {
            items: {
              type: "array",
              description: "Array of video cropping tasks",
              items: {
                type: "object",
                properties: {
                  videoUrl: { type: "string", description: "Source video URL to crop" },
                  startTime: { type: "number", description: "Start time in seconds" },
                  endTime: { type: "number", description: "End time in seconds" },
                },
                required: ["videoUrl", "startTime", "endTime"],
              },
            },
          },
          required: ["items"],
        },
      },
      {
        name: "concat_clips",
        description:
          "Concatenate multiple video clips into a single video via FC. Returns array of {status, videoUrl} for each concatenation task.",
        inputSchema: {
          type: "object" as const,
          properties: {
            items: {
              type: "array",
              description: "Array of video concatenation tasks",
              items: {
                type: "object",
                properties: {
                  clipUrls: {
                    type: "array",
                    items: { type: "string" },
                    description: "Array of video clip URLs to concatenate in order",
                  },
                },
                required: ["clipUrls"],
              },
            },
          },
          required: ["items"],
        },
      },
    ];
  },

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<CallToolResult> {
    switch (name) {
      case "generate_image": {
        const { items } = GenerateImageParams.parse(args);
        
        const results = await Promise.allSettled(
          items.map(async (item, i) => {
            try {
              const isGpt = item.model === "gpt";
              const url = isGpt 
                ? process.env.FC_GENERATE_IMAGE_GPT_URL 
                : process.env.FC_GENERATE_IMAGE_URL;
              const token = isGpt 
                ? process.env.FC_GENERATE_IMAGE_GPT_TOKEN 
                : process.env.FC_GENERATE_IMAGE_TOKEN;
              
              if (!url || !token) {
                throw new Error(
                  isGpt
                    ? "FC_GENERATE_IMAGE_GPT_URL and FC_GENERATE_IMAGE_GPT_TOKEN must be configured in .env"
                    : "FC_GENERATE_IMAGE_URL and FC_GENERATE_IMAGE_TOKEN must be configured in .env"
                );
              }

              const timeout = isGpt ? 180000 : 120000; // GPT: 3 min, Gemini: 2 min
              const imageUrl = await callFcEndpoint(
                url,
                token,
                {
                  prompt: item.prompt,
                  referenceImageUrls: item.referenceImageUrls,
                },
                timeout,
              );
              return { index: i, status: "ok" as const, imageUrl, model: item.model };
            } catch (e) {
              return {
                index: i,
                status: "error" as const,
                error: e instanceof Error ? e.message : String(e),
              };
            }
          }),
        );
        return json(results.map((r) => (r.status === "fulfilled" ? r.value : r.reason)));
      }

      case "generate_video": {
        const url = process.env.FC_GENERATE_VIDEO_URL;
        const token = process.env.FC_GENERATE_VIDEO_TOKEN;
        if (!url || !token) {
          return json([
            {
              status: "error",
              error: "FC_GENERATE_VIDEO_URL and FC_GENERATE_VIDEO_TOKEN must be configured in .env",
            },
          ]);
        }

        const { items } = GenerateVideoParams.parse(args);
        const results = await Promise.allSettled(
          items.map(async (item, i) => {
            try {
              const videoUrl = await callFcEndpoint(
                url,
                token,
                {
                  action: "generate",
                  prompt: item.prompt,
                  imageUrl: item.sourceImageUrl,
                  styleName: item.styleName,
                  referenceImageUrls: item.referenceImageUrls,
                  sourceVideoUrls: item.sourceVideoUrls,
                },
                300000, // 5 minutes for video generation
              );
              return { index: i, status: "ok" as const, videoUrl };
            } catch (e) {
              return {
                index: i,
                status: "error" as const,
                error: e instanceof Error ? e.message : String(e),
              };
            }
          }),
        );
        return json(results.map((r) => (r.status === "fulfilled" ? r.value : r.reason)));
      }

      case "crop_video": {
        const url = process.env.FC_CROP_VIDEO_URL;
        const token = process.env.FC_CROP_VIDEO_TOKEN;
        if (!url || !token) {
          return json([
            {
              status: "error",
              error: "FC_CROP_VIDEO_URL and FC_CROP_VIDEO_TOKEN must be configured in .env",
            },
          ]);
        }

        const { items } = CropVideoParams.parse(args);
        const results = await Promise.allSettled(
          items.map(async (item, i) => {
            try {
              const videoUrl = await callFcEndpoint(url, token, {
                videoUrl: item.videoUrl,
                startTime: item.startTime,
                endTime: item.endTime,
              });
              return { index: i, status: "ok" as const, videoUrl };
            } catch (e) {
              return {
                index: i,
                status: "error" as const,
                error: e instanceof Error ? e.message : String(e),
              };
            }
          }),
        );
        return json(results.map((r) => (r.status === "fulfilled" ? r.value : r.reason)));
      }

      case "concat_clips": {
        const url = process.env.FC_CONCAT_CLIPS_URL;
        const token = process.env.FC_CONCAT_CLIPS_TOKEN;
        if (!url || !token) {
          return json([
            {
              status: "error",
              error: "FC_CONCAT_CLIPS_URL and FC_CONCAT_CLIPS_TOKEN must be configured in .env",
            },
          ]);
        }

        const { items } = ConcatClipsParams.parse(args);
        const results = await Promise.allSettled(
          items.map(async (item, i) => {
            try {
              const videoUrl = await callFcEndpoint(
                url,
                token,
                {
                  clipUrls: item.clipUrls,
                },
                300000, // 5 minutes for concatenation
              );
              return { index: i, status: "ok" as const, videoUrl };
            } catch (e) {
              return {
                index: i,
                status: "error" as const,
                error: e instanceof Error ? e.message : String(e),
              };
            }
          }),
        );
        return json(results.map((r) => (r.status === "fulfilled" ? r.value : r.reason)));
      }

      default:
        return text(`Unknown tool: ${name}`);
    }
  },
};
