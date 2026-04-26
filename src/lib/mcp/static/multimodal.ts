import { z } from "zod";
import type { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types";
import type { McpProvider, ToolContext } from "../types";
import * as videoProcessing from "@/lib/services/video-processing-service";

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
          "Generate image(s) using Gemini model via FC. Returns array of {status, imageUrl} for each item.",
        inputSchema: {
          type: "object" as const,
          properties: {
            items: {
              type: "array",
              description: "Array of image generation tasks using Gemini model",
              items: {
                type: "object",
                properties: {
                  prompt: { type: "string", description: "Text prompt describing the image to generate" },
                  referenceImageUrls: {
                    type: "array",
                    items: { type: "string" },
                    description: "Optional reference image URLs for style/content guidance",
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
        name: "generate_image_gpt",
        description:
          "Generate image(s) using GPT model via FC. Returns array of {status, imageUrl} for each item.",
        inputSchema: {
          type: "object" as const,
          properties: {
            items: {
              type: "array",
              description: "Array of image generation tasks using GPT model",
              items: {
                type: "object",
                properties: {
                  prompt: { type: "string", description: "Text prompt describing the image to generate" },
                  referenceImageUrls: {
                    type: "array",
                    items: { type: "string" },
                    description: "Optional reference image URLs for style/content guidance",
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
          "Generate video(s) via Seedance through FC. Supports shotPrompt mode (recommended) with referenceImageUrls and sourceVideoUrls for continuation. Returns array of {status, videoUrl} for each item.",
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
    context?: ToolContext,
  ): Promise<CallToolResult> {
    switch (name) {
      case "generate_image": {
        const url = process.env.FC_GENERATE_IMAGE_URL;
        const token = process.env.FC_GENERATE_IMAGE_TOKEN;
        if (!url || !token) {
          return json([
            {
              status: "error",
              error: "FC_GENERATE_IMAGE_URL and FC_GENERATE_IMAGE_TOKEN must be configured in .env",
            },
          ]);
        }

        const { items } = GenerateImageParams.parse(args);
        const results = await Promise.allSettled(
          items.map(async (item, i) => {
            try {
              const imageUrl = await callFcEndpoint(url, token, {
                prompt: item.prompt,
                referenceImageUrls: item.referenceImageUrls,
              });
              return { index: i, status: "ok" as const, imageUrl };
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

      case "generate_image_gpt": {
        const url = process.env.FC_GENERATE_IMAGE_GPT_URL;
        const token = process.env.FC_GENERATE_IMAGE_GPT_TOKEN;
        if (!url || !token) {
          return json([
            {
              status: "error",
              error: "FC_GENERATE_IMAGE_GPT_URL and FC_GENERATE_IMAGE_GPT_TOKEN must be configured in .env",
            },
          ]);
        }

        const { items } = GenerateImageParams.parse(args);
        const results = await Promise.allSettled(
          items.map(async (item, i) => {
            try {
              const imageUrl = await callFcEndpoint(
                url,
                token,
                {
                  prompt: item.prompt,
                  referenceImageUrls: item.referenceImageUrls,
                },
                180000, // 3 minutes for GPT image generation
              );
              return { index: i, status: "ok" as const, imageUrl };
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
        const { items } = CropVideoParams.parse(args);
        const results = await Promise.allSettled(
          items.map(async (item, i) => {
            try {
              const videoUrl = await videoProcessing.cropVideo(
                item.videoUrl,
                item.startTime,
                item.endTime,
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

      case "concat_clips": {
        const { items } = ConcatClipsParams.parse(args);
        const results = await Promise.allSettled(
          items.map(async (item, i) => {
            try {
              const videoUrl = await videoProcessing.concatClips(item.clipUrls);
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
