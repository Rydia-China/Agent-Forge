import { z } from "zod";
import type { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types";
import type { McpProvider } from "../types";

function text(t: string): CallToolResult {
  return { content: [{ type: "text", text: t }] };
}

function json(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function getFcConfig() {
  const imageUrl = process.env.FC_GENERATE_IMAGE_URL;
  const imageToken = process.env.FC_GENERATE_IMAGE_TOKEN;
  const videoUrl = process.env.FC_GENERATE_VIDEO_URL;
  const videoToken = process.env.FC_GENERATE_VIDEO_TOKEN;
  return { imageUrl, imageToken, videoUrl, videoToken };
}

const FcResultSchema = z.object({
  result: z.string().optional(),
  error: z.string().optional(),
});

const GenerateImageParams = z.object({
  prompt: z.string().min(1, "prompt is required"),
  referenceImageUrls: z.array(z.string().url()).optional(),
});

const GenerateVideoParams = z.object({
  imageUrl: z.string().url("imageUrl must be a valid URL"),
  prompt: z.string().min(1, "prompt is required"),
});

export const videoMgrMcp: McpProvider = {
  name: "video_mgr",

  async listTools(): Promise<Tool[]> {
    return [
      {
        name: "generate_image",
        description:
          "Generate an image from a text prompt (via FC). Returns the URL of the generated image.",
        inputSchema: {
          type: "object" as const,
          properties: {
            prompt: {
              type: "string",
              description: "Text prompt describing the image to generate",
            },
            referenceImageUrls: {
              type: "array",
              items: { type: "string" },
              description: "Optional reference image URLs for style/content guidance",
            },
          },
          required: ["prompt"],
        },
      },
      {
        name: "generate_video",
        description:
          "Generate a video from an image and a motion prompt (via FC). Returns the URL of the generated video.",
        inputSchema: {
          type: "object" as const,
          properties: {
            imageUrl: {
              type: "string",
              description: "Source image URL to animate",
            },
            prompt: {
              type: "string",
              description: "Text prompt describing the desired motion/animation",
            },
          },
          required: ["imageUrl", "prompt"],
        },
      },
    ];
  },

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<CallToolResult> {
    const fc = getFcConfig();

    switch (name) {
      case "generate_image": {
        if (!fc.imageUrl || !fc.imageToken) {
          return text("未配置 FC 图像生成服务 (FC_GENERATE_IMAGE_URL, FC_GENERATE_IMAGE_TOKEN)");
        }
        const { prompt, referenceImageUrls } = GenerateImageParams.parse(args);
        const res = await fetch(fc.imageUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${fc.imageToken}`,
          },
          body: JSON.stringify({ prompt, referenceImageUrls }),
        });
        const data: unknown = await res.json();
        const parsed = FcResultSchema.parse(data);
        if (!res.ok || parsed.error) {
          return text(`Image generation failed: ${parsed.error ?? res.statusText}`);
        }
        if (!parsed.result) return text("FC returned no result");
        return json({ imageUrl: parsed.result });
      }

      case "generate_video": {
        if (!fc.videoUrl || !fc.videoToken) {
          return text("未配置 FC 视频生成服务 (FC_GENERATE_VIDEO_URL, FC_GENERATE_VIDEO_TOKEN)");
        }
        const { imageUrl, prompt } = GenerateVideoParams.parse(args);
        const res = await fetch(fc.videoUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${fc.videoToken}`,
          },
          body: JSON.stringify({ action: "generate", imageUrl, prompt }),
        });
        const data: unknown = await res.json();
        const parsed = FcResultSchema.parse(data);
        if (!res.ok || parsed.error) {
          return text(`Video generation failed: ${parsed.error ?? res.statusText}`);
        }
        if (!parsed.result) return text("FC returned no result");
        return json({ videoUrl: parsed.result });
      }

      default:
        return text(`Unknown tool: ${name}`);
    }
  },
};
