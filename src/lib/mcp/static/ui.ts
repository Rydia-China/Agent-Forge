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

/* ==================================================================
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

      default:
        return text(`Unknown tool: ${name}`);
    }
  },
};
