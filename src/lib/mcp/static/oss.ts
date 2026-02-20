import { z } from "zod";
import type { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types";
import type { McpProvider } from "../types";
import * as svc from "@/lib/services/oss-service";

function text(t: string): CallToolResult {
  return { content: [{ type: "text", text: t }] };
}

function json(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

export const ossMcp: McpProvider = {
  name: "oss",

  async listTools(): Promise<Tool[]> {
    return [
      {
        name: "upload_from_url",
        description:
          "Download file(s) from URL(s) and upload to OSS concurrently. Returns an array of results with status (ok/error) and permanent OSS URL for each item. For a single file, pass a one-element array.",
        inputSchema: {
          type: "object" as const,
          properties: {
            items: {
              type: "array",
              description: "Array of files to download and upload",
              items: {
                type: "object",
                properties: {
                  url: { type: "string", description: "Source URL to download from" },
                  folder: { type: "string", description: 'OSS folder name (e.g. "image", "video", "file"). Default: "file"' },
                  filename: { type: "string", description: "Target filename (auto-generated if omitted)" },
                },
                required: ["url"],
              },
            },
          },
          required: ["items"],
        },
      },
      {
        name: "upload_base64",
        description:
          "Upload base64-encoded content to OSS. Returns the permanent OSS URL. Useful for uploading agent-generated content directly.",
        inputSchema: {
          type: "object" as const,
          properties: {
            data: {
              type: "string",
              description: "Base64-encoded file content",
            },
            filename: {
              type: "string",
              description: 'Target filename with extension (e.g. "diagram.png")',
            },
            folder: {
              type: "string",
              description: 'OSS folder name. Default: "file"',
            },
          },
          required: ["data", "filename"],
        },
      },
      {
        name: "delete",
        description:
          "Delete object(s) from OSS concurrently. Pass an array of object names. For a single deletion, pass a one-element array.",
        inputSchema: {
          type: "object" as const,
          properties: {
            objectNames: {
              type: "array",
              items: { type: "string" },
              description: 'Array of full OSS object paths (e.g. ["public/image/1234-abc.png"])',
            },
          },
          required: ["objectNames"],
        },
      },
    ];
  },

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<CallToolResult> {
    switch (name) {
      case "upload_from_url": {
        const { items } = z
          .object({ items: z.array(svc.UploadFromUrlParams).min(1) })
          .parse(args);
        const results = await svc.batchUploadFromUrl(items);
        return json(results);
      }

      case "upload_base64": {
        const { data, filename, folder } = svc.UploadBase64Params.parse(args);
        const buffer = Buffer.from(data, "base64");
        const url = await svc.uploadBuffer(buffer, filename, folder);
        return json({ url });
      }

      case "delete": {
        const { objectNames } = z
          .object({ objectNames: z.array(z.string().min(1)).min(1) })
          .parse(args);
        const results = await svc.batchDelete(objectNames);
        return json(results);
      }

      default:
        return text(`Unknown tool: ${name}`);
    }
  },
};
