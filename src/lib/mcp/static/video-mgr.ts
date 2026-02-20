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
      imageUrl: z.string().url(),
      prompt: z.string().min(1),
    }),
  ).min(1),
});

export const videoMgrMcp: McpProvider = {
  name: "video_mgr",

  async listTools(): Promise<Tool[]> {
    return [
      {
        name: "generate_image",
        description:
          "Generate image(s) from text prompt(s) concurrently (via FC). Returns an array of results with status (ok/error) and image URL. For a single image, pass a one-element array.",
        inputSchema: {
          type: "object" as const,
          properties: {
            items: {
              type: "array",
              description: "Array of image generation tasks",
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
          "Generate video(s) from image(s) and motion prompt(s) concurrently (via FC). Returns an array of results with status (ok/error) and video URL. For a single video, pass a one-element array.",
        inputSchema: {
          type: "object" as const,
          properties: {
            items: {
              type: "array",
              description: "Array of video generation tasks",
              items: {
                type: "object",
                properties: {
                  imageUrl: { type: "string", description: "Source image URL to animate" },
                  prompt: { type: "string", description: "Text prompt describing the desired motion/animation" },
                },
                required: ["imageUrl", "prompt"],
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
    const fc = getFcConfig();

    switch (name) {
      case "generate_image": {
        if (!fc.imageUrl || !fc.imageToken) {
          return text("未配置 FC 图像生成服务 (FC_GENERATE_IMAGE_URL, FC_GENERATE_IMAGE_TOKEN)");
        }
        const { items } = GenerateImageParams.parse(args);
        const results = await Promise.allSettled(
          items.map(async ({ prompt, referenceImageUrls }) => {
            const res = await fetch(fc.imageUrl!, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${fc.imageToken}`,
              },
              body: JSON.stringify({ prompt, referenceImageUrls }),
            });
            const data: unknown = await res.json();
            const parsed = FcResultSchema.parse(data);
            if (!res.ok || parsed.error) throw new Error(parsed.error ?? res.statusText);
            if (!parsed.result) throw new Error("FC returned no result");
            return parsed.result;
          }),
        );
        const imgOutput = results.map((r, i) =>
          r.status === "fulfilled"
            ? { index: i, status: "ok" as const, imageUrl: r.value }
            : { index: i, status: "error" as const, error: r.reason instanceof Error ? r.reason.message : String(r.reason) },
        );
        return json(imgOutput);
      }

      case "generate_video": {
        if (!fc.videoUrl || !fc.videoToken) {
          return text("未配置 FC 视频生成服务 (FC_GENERATE_VIDEO_URL, FC_GENERATE_VIDEO_TOKEN)");
        }
        const { items } = GenerateVideoParams.parse(args);
        const results = await Promise.allSettled(
          items.map(async ({ imageUrl, prompt }) => {
            const res = await fetch(fc.videoUrl!, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${fc.videoToken}`,
              },
              body: JSON.stringify({ action: "generate", imageUrl, prompt }),
            });
            const data: unknown = await res.json();
            const parsed = FcResultSchema.parse(data);
            if (!res.ok || parsed.error) throw new Error(parsed.error ?? res.statusText);
            if (!parsed.result) throw new Error("FC returned no result");
            return parsed.result;
          }),
        );
        const vidOutput = results.map((r, i) =>
          r.status === "fulfilled"
            ? { index: i, status: "ok" as const, videoUrl: r.value }
            : { index: i, status: "error" as const, error: r.reason instanceof Error ? r.reason.message : String(r.reason) },
        );
        return json(vidOutput);
      }

      default:
        return text(`Unknown tool: ${name}`);
    }
  },
};
