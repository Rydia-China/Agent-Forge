import { z } from "zod";
import type { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types";
import type { McpProvider, ToolContext } from "../types";
import * as keyResourceService from "@/lib/services/key-resource-service";
import { upsertByKeyResource } from "@/lib/domain/resource-service";
import { generateVideo } from "@/lib/services/seedance-client";
import { extractVideoSegment } from "@/lib/services/video-process-service";
import * as ossService from "@/lib/services/oss-service";

function text(t: string): CallToolResult {
  return { content: [{ type: "text", text: t }] };
}

function json(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

const GenerateImageParams = z.object({
  items: z.array(
    z.object({
      key: z.string().min(1),
      prompt: z.string().min(1),
      referenceImageUrls: z.array(z.string().url()).optional(),
      /** Resource classification — required for auto-writeback to domain_resources */
      category: z.string().min(1),
      scopeType: z.enum(["novel", "script"]),
      scopeId: z.string().min(1),
      title: z.string().optional(),
    }),
  ).min(1),
});

const ResolveKeyResourceParams = z.object({
  ids: z.array(z.string().min(1)).min(1),
});

const GenerateVideoParams = z.object({
  items: z.array(
    z.object({
      key: z.string().min(1),
      prompt: z.string().min(1),
      generateType: z.enum(["text_to_video", "first_frame", "first_last_frame", "multimodal"]).optional(),
      sourceImageUrl: z.string().url().optional(),
      sourceImageUrls: z.array(z.string().url()).optional(),
      sourceVideoUrls: z.array(z.string().url()).optional(),
      sourceAudioUrls: z.array(z.string().url()).optional(),
      category: z.string().min(1),
      scopeType: z.enum(["novel", "script"]),
      scopeId: z.string().min(1),
      title: z.string().optional(),
      /** Seedance 2.0 options */
      model: z.enum(["seedance_2_0", "seedance_2_0_fast"]).optional(),
      duration: z.number().min(4).max(15).optional(),
      resolution: z.enum(["480p", "720p"]).optional(),
      aspectRatio: z.string().optional(),
    }),
  ).min(1),
});

const ExtractVideoSegmentParams = z.object({
  sourceVideoUrl: z.string().url(),
  startSec: z.number().min(0),
  endSec: z.number().min(0).nullable(),
  key: z.string().min(1),
  category: z.string().min(1),
  scopeType: z.enum(["novel", "script"]),
  scopeId: z.string().min(1),
  title: z.string().optional(),
});

export const videoMgrMcp: McpProvider = {
  name: "video_mgr",

  async listTools(): Promise<Tool[]> {
    return [
      {
        name: "generate_image",
        description:
          "Generate image(s) from text prompt(s) via FC. Images are automatically persisted to DB on success (both key_resource for version tracking and domain_resources for UI display) — no additional save step needed. Each item requires a unique `key` (session-scoped); re-using an existing key creates a new version. Returns array of {status, imageUrl, key, keyResourceId, version}.",
        inputSchema: {
          type: "object" as const,
          properties: {
            items: {
              type: "array",
              description: "Array of image generation tasks. Each item auto-creates a domain_resources entry.",
              items: {
                type: "object",
                properties: {
                  key: { type: "string", description: "Unique semantic key for this image within the session (e.g. char_alice_portrait, scene_1_bg, shot_1_3). Re-using an existing key creates a new version." },
                  prompt: { type: "string", description: "Text prompt describing the image to generate" },
                  referenceImageUrls: {
                    type: "array",
                    items: { type: "string" },
                    description: "Optional reference image URLs for style/content guidance",
                  },
                  category: { type: "string", description: "Resource category for UI grouping (LLM decides, e.g. '角色立绘', '场景', '服装', '分镜')" },
                  scopeType: { type: "string", enum: ["novel", "script"], description: "Scope level: 'novel' for novel-wide resources, 'script' for episode-scoped. Injected by context provider for internal agents; external callers must resolve from biz_db (novel_scripts table)." },
                  scopeId: { type: "string", description: "ID of the scope entity (novel ID or script DB ID). Injected by context provider for internal agents; external callers must resolve from biz_db (novel_scripts table)." },
                  title: { type: "string", description: "Human-readable label shown in resource panel (e.g. character name, scene title)" },
                },
                required: ["key", "prompt", "category", "scopeType", "scopeId"],
              },
            },
          },
          required: ["items"],
        },
      },
      {
        name: "generate_video",
        description:
          "Generate video(s) from prompt via Seedance 2.0. Supports: text-to-video, image-to-video (first_frame), and multimodal (reference videos/images/audio for continuation/style transfer). Videos are automatically persisted to DB on success. Each item requires a unique `key`; re-using an existing key creates a new version. Generation takes 2–4 minutes per video. Returns array of {status, videoUrl, key, keyResourceId, version}.",
        inputSchema: {
          type: "object" as const,
          properties: {
            items: {
              type: "array",
              description: "Array of video generation tasks. Each auto-creates a domain_resources entry.",
              items: {
                type: "object",
                properties: {
                  key: { type: "string", description: "Unique semantic key for this video within the session (e.g. video_shot_1_3, video_scene_2_opening). Re-using an existing key creates a new version." },
                  prompt: { type: "string", description: "Motion/animation prompt describing the desired video effect" },
                  generateType: { type: "string", enum: ["text_to_video", "first_frame", "first_last_frame", "multimodal"], description: "Generation mode. Auto-inferred if omitted: text_to_video (no refs), first_frame (1 image), multimodal (video/audio refs). Use 'multimodal' for video continuation." },
                  sourceImageUrl: { type: "string", description: "(Deprecated: use sourceImageUrls) Single source image URL for first_frame mode" },
                  sourceImageUrls: { type: "array", items: { type: "string" }, description: "Source image URLs (max 9 for multimodal, 1 for first_frame, 2 for first_last_frame)" },
                  sourceVideoUrls: { type: "array", items: { type: "string" }, description: "Source video URLs (max 3, multimodal only). Use for video continuation: extract last N seconds of source video, pass here with continuation prompt." },
                  sourceAudioUrls: { type: "array", items: { type: "string" }, description: "Source audio URLs (max 3, multimodal only)" },
                  category: { type: "string", description: "Resource category for UI grouping (e.g. '分镜视频', '片头', '转场')" },
                  scopeType: { type: "string", enum: ["novel", "script"], description: "Scope level. Injected by context provider for internal agents." },
                  scopeId: { type: "string", description: "ID of the scope entity. Injected by context provider for internal agents." },
                  title: { type: "string", description: "Human-readable label shown in resource panel" },
                  model: { type: "string", enum: ["seedance_2_0", "seedance_2_0_fast"], description: "Model variant. Default: seedance_2_0_fast" },
                  duration: { type: "number", description: "Video duration in seconds (4–15). Default: 5" },
                  resolution: { type: "string", enum: ["480p", "720p"], description: "Output resolution. Default: 720p" },
                  aspectRatio: { type: "string", description: "Aspect ratio (e.g. 16:9, 9:16, 1:1). Default: 16:9" },
                },
                required: ["key", "prompt", "category", "scopeType", "scopeId"],
              },
            },
          },
          required: ["items"],
        },
      },
      {
        name: "extract_video_segment",
        description:
          "Extract a segment from a video by specifying start and end time in seconds. Supports: extracting arbitrary ranges (e.g. [3,5] = 3rd to 5th sec), first N seconds ([0,N]), or last N seconds (compute duration first). Downloads source, extracts segment via ffmpeg, uploads to OSS, and persists to DB. Returns {videoUrl, keyResourceId, version}.",
        inputSchema: {
          type: "object" as const,
          properties: {
            sourceVideoUrl: { type: "string", description: "URL of the source video" },
            startSec: { type: "number", description: "Start time in seconds (inclusive, >= 0)" },
            endSec: { type: ["number", "null"], description: "End time in seconds (exclusive, > startSec), or null to extract till the end" },
            key: { type: "string", description: "Unique semantic key for this clip (e.g. shot_1_3_segment). Re-using an existing key creates a new version." },
            category: { type: "string", description: "Resource category for UI grouping (e.g. '分镜视频', '片段')" },
            scopeType: { type: "string", enum: ["novel", "script"], description: "Scope level" },
            scopeId: { type: "string", description: "ID of the scope entity" },
            title: { type: "string", description: "Human-readable label shown in resource panel" },
          },
          required: ["sourceVideoUrl", "startSec", "key", "category", "scopeType", "scopeId"],
        },
      },
      {
        name: "resolve_key_resource",
        description:
          "Resolve one or more KeyResource IDs to their current-version URLs. Use this to look up the actual URL of a resource stored by its key_resource_id in biz tables.",
        inputSchema: {
          type: "object" as const,
          properties: {
            ids: {
              type: "array",
              items: { type: "string" },
              description: "Array of KeyResource IDs to resolve",
            },
          },
          required: ["ids"],
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
        const { items } = GenerateImageParams.parse(args);
        const results = await Promise.allSettled(
          items.map(async ({ key, prompt, referenceImageUrls, scopeType, scopeId }) => {
            return keyResourceService.generateImage({
              scopeType,
              scopeId,
              key,
              prompt,
              refUrls: referenceImageUrls,
            });
          }),
        );

        // Auto-writeback: create domain_resources entries for successful generations
        const imgOutput = await Promise.all(
          results.map(async (r, i) => {
            const item = items[i]!;
            if (r.status !== "fulfilled") {
              return {
                index: i,
                status: "error" as const,
                key: item.key,
                error: r.reason instanceof Error ? r.reason.message : String(r.reason),
              };
            }
            const gen = r.value;
            try {
              await upsertByKeyResource({
                scopeType: item.scopeType,
                scopeId: item.scopeId,
                category: item.category,
                mediaType: "image",
                title: item.title ?? undefined,
                url: gen.imageUrl ?? undefined,
                data: { prompt: item.prompt },
                keyResourceId: gen.id,
              });
            } catch (e) {
              console.error(`[video_mgr] domain_resources writeback failed for key=${item.key}:`, e);
            }
            return {
              index: i,
              status: "ok" as const,
              key: gen.key,
              keyResourceId: gen.id,
              imageUrl: gen.imageUrl,
              version: gen.version,
            };
          }),
        );
        return json(imgOutput);
      }

      case "generate_video": {
        const { items } = GenerateVideoParams.parse(args);
        // Generate videos sequentially to avoid overwhelming the API
        const vidOutput: unknown[] = [];
        for (let i = 0; i < items.length; i++) {
          const item = items[i]!;
          try {
            // Merge image URLs (backward compat: sourceImageUrl → sourceImageUrls)
            const imageUrls = [
              ...(item.sourceImageUrls ?? []),
              ...(item.sourceImageUrl ? [item.sourceImageUrl] : []),
            ];
            const videoUrls = item.sourceVideoUrls ?? [];
            const audioUrls = item.sourceAudioUrls ?? [];

            // Collect all ref URLs for KeyResource tracking
            const allRefUrls = [...imageUrls, ...videoUrls, ...audioUrls];

            // 1. Call Seedance 2.0 API
            const result = await generateVideo({
              prompt: item.prompt,
              model: item.model,
              generateType: item.generateType,
              imageUrls,
              videoUrls,
              audioUrls,
              duration: item.duration,
              resolution: item.resolution,
              aspectRatio: item.aspectRatio,
            });

            // 2. Create KeyResource version with the generated URL
            const kr = await keyResourceService.upsertResource(
              item.scopeType,
              item.scopeId,
              item.key,
              "video",
              {
                prompt: item.prompt,
                url: result.saveUrl,
                refUrls: allRefUrls.length > 0 ? allRefUrls : undefined,
              },
            );

            // 3. Writeback to domain_resources for UI display
            await upsertByKeyResource({
              scopeType: item.scopeType,
              scopeId: item.scopeId,
              category: item.category,
              mediaType: "video",
              title: item.title ?? undefined,
              url: result.saveUrl,
              data: { prompt: item.prompt, sourceImageUrl: imageUrls[0] ?? null },
              keyResourceId: kr.id,
            });

            vidOutput.push({
              index: i,
              status: "ok" as const,
              key: item.key,
              keyResourceId: kr.id,
              version: kr.version,
              videoUrl: result.saveUrl,
              timingMs: result.timingMs,
            });
          } catch (e) {
            vidOutput.push({
              index: i,
              status: "error" as const,
              key: item.key,
              error: e instanceof Error ? e.message : String(e),
            });
          }
        }
        return json(vidOutput);
      }

      case "extract_video_segment": {
        const params = ExtractVideoSegmentParams.parse(args);

        // 1. Extract segment via ffmpeg
        const clipBuffer = await extractVideoSegment(
          params.sourceVideoUrl,
          params.startSec,
          params.endSec,
        );

        // 2. Upload to OSS
        const filename = ossService.generateFilename("clip.mp4", "clip");
        const videoUrl = await ossService.uploadBuffer(
          clipBuffer,
          filename,
          "video",
        );

        // 3. Create KeyResource version
        const kr = await keyResourceService.upsertResource(
          params.scopeType,
          params.scopeId,
          params.key,
          "video",
          {
            prompt: `extracted segment [${params.startSec}s, ${params.endSec ?? "end"}s) from ${params.sourceVideoUrl}`,
            url: videoUrl,
            refUrls: [params.sourceVideoUrl],
          },
        );

        // 4. Writeback to domain_resources
        await upsertByKeyResource({
          scopeType: params.scopeType,
          scopeId: params.scopeId,
          category: params.category,
          mediaType: "video",
          title: params.title ?? undefined,
          url: videoUrl,
          keyResourceId: kr.id,
        });

        return json({
          status: "ok",
          key: params.key,
          keyResourceId: kr.id,
          version: kr.version,
          videoUrl,
        });
      }


      case "resolve_key_resource": {
        const { ids } = ResolveKeyResourceParams.parse(args);
        const results = await Promise.all(
          ids.map(async (id) => {
            const detail = await keyResourceService.getById(id);
            if (!detail) return { id, status: "not_found" as const };
            return {
              id,
              status: "ok" as const,
              key: detail.key,
              url: detail.url,
              mediaType: detail.mediaType,
              version: detail.currentVersion,
            };
          }),
        );
        return json(results);
      }

      default:
        return text(`Unknown tool: ${name}`);
    }
  },
};
