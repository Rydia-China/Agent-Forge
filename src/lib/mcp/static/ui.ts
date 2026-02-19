import type { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types";
import type { McpProvider } from "../types";
import { z } from "zod";
import crypto from "node:crypto";

/* ================================================================== */
/*  Shared helpers                                                     */
/* ================================================================== */

function text(t: string): CallToolResult {
  return { content: [{ type: "text", text: t }] };
}

/* ================================================================== */
/*  1. request_upload  (migrated from upload.ts)                       */
/* ================================================================== */

const RequestUploadParams = z.object({
  endpoint: z.string().url(),
  method: z.enum(["PUT", "POST"]).optional().default("POST"),
  headers: z.record(z.string(), z.string()).optional(),
  fields: z.record(z.string(), z.string()).optional(),
  fileFieldName: z.string().optional().default("file"),
  accept: z.string().optional(),
  purpose: z.string().optional(),
  maxSizeMB: z.number().positive().optional(),
  bodyTemplate: z.record(z.string(), z.string()).optional(),
  timeout: z.number().positive().optional(),
});

export interface UploadRequest {
  uploadId: string;
  endpoint: string;
  method: "PUT" | "POST";
  headers?: Record<string, string>;
  fields?: Record<string, string>;
  fileFieldName: string;
  accept?: string;
  purpose?: string;
  maxSizeMB?: number;
  bodyTemplate?: Record<string, string>;
  timeout?: number;
}

function uploadResult(req: UploadRequest): CallToolResult {
  const result = text(
    JSON.stringify({ uploadId: req.uploadId, status: "pending" }),
  );
  (result as Record<string, unknown>)._uploadRequest = req;
  return result;
}

/* ================================================================== */
/*  2. present_media                                                   */
/* ================================================================== */

const PresentMediaItem = z.object({
  url: z.string().url(),
  mediaType: z.enum(["image", "video"]),
  title: z.string().optional(),
});

const PresentMediaParams = z.union([
  // Batch mode: items array
  z.object({
    items: z.array(PresentMediaItem).min(1),
  }),
  // Single mode: direct fields (backward compat)
  PresentMediaItem,
]);

/* ================================================================== */
/*  3. present_data                                                    */
/* ================================================================== */

const PresentDataParams = z.object({
  data: z.union([z.string(), z.record(z.string(), z.unknown()), z.array(z.unknown())]),
  title: z.string().optional(),
  format: z.enum(["json", "text"]).optional().default("json"),
});

/* ================================================================== */
/*  Key Resource side-channel type                                     */
/* ================================================================== */

export interface KeyResourcePayload {
  id: string;
  mediaType: "image" | "video" | "json";
  url?: string;
  data?: unknown;
  title?: string;
}

function keyResourceResult(payload: KeyResourcePayload): CallToolResult {
  const result = text(
    JSON.stringify({ presented: true, mediaType: payload.mediaType, title: payload.title ?? null }),
  );
  (result as Record<string, unknown>)._keyResource = payload;
  return result;
}

/** Batch variant: multiple key resources in one tool call. */
function keyResourceBatchResult(payloads: KeyResourcePayload[]): CallToolResult {
  const result = text(
    JSON.stringify({ presented: true, count: payloads.length }),
  );
  (result as Record<string, unknown>)._keyResources = payloads;
  return result;
}

/* ================================================================== */
/*  Provider                                                           */
/* ================================================================== */

export const uiMcp: McpProvider = {
  name: "ui",

  async listTools(): Promise<Tool[]> {
    return [
      /* ---------- request_upload ---------- */
      {
        name: "request_upload",
        description:
          "Request the user to upload a local file to a specified endpoint. " +
          "The file is uploaded directly from the browser — it never passes through LLM context. " +
          "Use this when the user needs to upload images, videos, documents, or other files from their device. " +
          "You specify the target endpoint and upload parameters; the frontend handles the actual file transfer. " +
          "You will receive the upload result (URL, filename, size) once the user completes or cancels the upload.",
        inputSchema: {
          type: "object" as const,
          properties: {
            endpoint: {
              type: "string",
              description: "Target URL to upload the file to",
            },
            method: {
              type: "string",
              enum: ["PUT", "POST"],
              description: 'HTTP method. Default: "POST"',
            },
            headers: {
              type: "object",
              additionalProperties: { type: "string" },
              description: "Extra HTTP headers for the upload request",
            },
            fields: {
              type: "object",
              additionalProperties: { type: "string" },
              description:
                "Additional form fields to include (POST multipart only)",
            },
            fileFieldName: {
              type: "string",
              description:
                'Name of the file field in multipart form. Default: "file"',
            },
            accept: {
              type: "string",
              description:
                'File type filter for the file picker (e.g. "image/*", ".txt,.md")',
            },
            purpose: {
              type: "string",
              description:
                "A brief description shown to the user explaining what this upload is for",
            },
            maxSizeMB: {
              type: "number",
              description: "Maximum file size in MB (frontend validation)",
            },
            bodyTemplate: {
              type: "object",
              additionalProperties: { type: "string" },
              description:
                "JSON body template. The file is read as text and substituted into placeholders. " +
                "Supported placeholders: {{fileContent}} (file text), {{fileName}} (filename without extension), " +
                "{{fileNameFull}} (filename with extension), {{timestamp}} (MM-DD-HH:mm). " +
                "When bodyTemplate is set, the request is sent as application/json instead of multipart. " +
                'Example: { "name": "{{fileName}}_{{timestamp}}", "content": "{{fileContent}}" }',
            },
            timeout: {
              type: "number",
              description:
                "Request timeout in seconds. Default: 60. Set higher for large file uploads.",
            },
          },
          required: ["endpoint"],
        },
      },

      /* ---------- present_media ---------- */
      {
        name: "present_media",
        description:
          "Present image(s) or video(s) to the user in the Key Resources panel. " +
          "Supports two modes: single item (url + mediaType) or batch (items array). " +
          "ALWAYS prefer batch mode when presenting multiple media — do NOT call this tool multiple times.",
        inputSchema: {
          type: "object" as const,
          properties: {
            url: {
              type: "string",
              description: "URL of a single image or video (single mode)",
            },
            mediaType: {
              type: "string",
              enum: ["image", "video"],
              description: 'Type of media: "image" or "video" (single mode)',
            },
            title: {
              type: "string",
              description: "Optional title/caption (single mode)",
            },
            items: {
              type: "array",
              description:
                "Batch mode: array of media items. Each item has url, mediaType, and optional title. " +
                "Use this when presenting multiple images/videos at once.",
              items: {
                type: "object",
                properties: {
                  url: { type: "string" },
                  mediaType: { type: "string", enum: ["image", "video"] },
                  title: { type: "string" },
                },
                required: ["url", "mediaType"],
              },
            },
          },
        },
      },

      /* ---------- present_data ---------- */
      {
        name: "present_data",
        description:
          "Present structured data (JSON, text) to the user in a browsable panel. " +
          "The data is NOT included in LLM context — it goes directly to the frontend " +
          "where the user can expand and browse it in a drawer. " +
          "Use this for large JSON results, API responses, or structured data the user may want to inspect.",
        inputSchema: {
          type: "object" as const,
          properties: {
            data: {
              description:
                "The data to present. Can be a JSON object, array, or string.",
            },
            title: {
              type: "string",
              description: "Title for the data panel",
            },
            format: {
              type: "string",
              enum: ["json", "text"],
              description: 'Display format. Default: "json"',
            },
          },
          required: ["data"],
        },
      },
    ];
  },

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<CallToolResult> {
    switch (name) {
      case "request_upload": {
        const params = RequestUploadParams.parse(args);
        const req: UploadRequest = {
          uploadId: crypto.randomUUID(),
          ...params,
        };
        return uploadResult(req);
      }

      case "present_media": {
        const params = PresentMediaParams.parse(args);
        if ("items" in params) {
          const payloads = params.items.map((item) => ({
            id: crypto.randomUUID(),
            mediaType: item.mediaType,
            url: item.url,
            title: item.title,
          }));
          return keyResourceBatchResult(payloads);
        }
        return keyResourceResult({
          id: crypto.randomUUID(),
          mediaType: params.mediaType,
          url: params.url,
          title: params.title,
        });
      }

      case "present_data": {
        const params = PresentDataParams.parse(args);
        const dataValue =
          typeof params.data === "string" && params.format === "json"
            ? (() => {
                try {
                  return JSON.parse(params.data) as unknown;
                } catch {
                  return params.data;
                }
              })()
            : params.data;
        return keyResourceResult({
          id: crypto.randomUUID(),
          mediaType: "json",
          data: dataValue,
          title: params.title,
        });
      }

      default:
        return text(`Unknown tool: ${name}`);
    }
  },
};
