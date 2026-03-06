import { z } from "zod";
import type { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types";
import type { McpProvider, ToolContext } from "../types";
import * as keyResourceService from "@/lib/services/key-resource-service";
import { upsertByKeyResource } from "@/lib/domain/resource-service";

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
      sourceImageUrl: z.string().url().optional(),
      category: z.string().min(1),
      scopeType: z.enum(["novel", "script"]),
      scopeId: z.string().min(1),
      title: z.string().optional(),
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
                  scopeType: { type: "string", enum: ["novel", "script"], description: "Scope level: 'novel' for novel-wide resources, 'script' for episode-scoped" },
                  scopeId: { type: "string", description: "ID of the scope entity (novel ID or script DB ID)" },
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
          "Store video generation prompt(s) for storyboard shots. Prompt is automatically persisted to domain_resources (mediaType=video) on success — no additional save step needed. Does NOT generate actual video; users can trigger actual generation later from the UI.",
        inputSchema: {
          type: "object" as const,
          properties: {
            items: {
              type: "array",
              description: "Array of video prompt entries. Each auto-creates a domain_resources entry with mediaType=video.",
              items: {
                type: "object",
                properties: {
                  key: { type: "string", description: "Unique semantic key for this video within the session (e.g. video_shot_1_3, video_scene_2_opening)" },
                  prompt: { type: "string", description: "Motion/animation prompt describing the desired video effect" },
                  sourceImageUrl: { type: "string", description: "Optional source image URL (typically from generate_image output) to animate" },
                  category: { type: "string", description: "Resource category for UI grouping (e.g. '分镜视频', '片头', '转场')" },
                  scopeType: { type: "string", enum: ["novel", "script"], description: "Scope level" },
                  scopeId: { type: "string", description: "ID of the scope entity" },
                  title: { type: "string", description: "Human-readable label shown in resource panel" },
                },
                required: ["key", "prompt", "category", "scopeType", "scopeId"],
              },
            },
          },
          required: ["items"],
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
        const vidOutput = await Promise.all(
          items.map(async (item, i) => {
            try {
              // Create a KeyResource for version tracking
              const kr = await keyResourceService.upsertResource(
                item.scopeType,
                item.scopeId,
                item.key,
                "video",
                {
                  prompt: item.prompt,
                  refUrls: item.sourceImageUrl ? [item.sourceImageUrl] : [],
                },
              );
              // Writeback to domain_resources for UI display
              await upsertByKeyResource({
                scopeType: item.scopeType,
                scopeId: item.scopeId,
                category: item.category,
                mediaType: "video",
                title: item.title ?? undefined,
                keyResourceId: kr.id,
              });
              return {
                index: i,
                status: "ok" as const,
                key: item.key,
                keyResourceId: kr.id,
                version: kr.version,
                prompt: item.prompt,
                sourceImageUrl: item.sourceImageUrl ?? null,
                note: "Prompt stored. No actual video generation — user can trigger later.",
              };
            } catch (e) {
              return {
                index: i,
                status: "error" as const,
                key: item.key,
                error: e instanceof Error ? e.message : String(e),
              };
            }
          }),
        );
        return json(vidOutput);
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
