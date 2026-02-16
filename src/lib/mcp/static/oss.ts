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
          "Download a file from the given URL and upload it to OSS. Returns the permanent OSS URL. Useful for persisting generated images/videos or external resources.",
        inputSchema: {
          type: "object" as const,
          properties: {
            url: {
              type: "string",
              description: "Source URL to download from",
            },
            folder: {
              type: "string",
              description:
                'OSS folder name (e.g. "image", "video", "file"). Default: "file"',
            },
            filename: {
              type: "string",
              description:
                "Target filename. If omitted, auto-generated from source URL or timestamp",
            },
          },
          required: ["url"],
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
          "Delete an object from OSS by its full object name (e.g. public/image/xxx.png).",
        inputSchema: {
          type: "object" as const,
          properties: {
            objectName: {
              type: "string",
              description:
                'Full OSS object path (e.g. "public/image/1234-abc.png")',
            },
          },
          required: ["objectName"],
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
        const { url, folder, filename } = svc.UploadFromUrlParams.parse(args);
        const result = await svc.uploadFromUrl(url, folder, filename);
        return json(result);
      }

      case "upload_base64": {
        const { data, filename, folder } = svc.UploadBase64Params.parse(args);
        const buffer = Buffer.from(data, "base64");
        const url = await svc.uploadBuffer(buffer, filename, folder);
        return json({ url });
      }

      case "delete": {
        const { objectName } = svc.DeleteObjectParams.parse(args);
        await svc.deleteObject(objectName);
        return text(`Deleted: ${objectName}`);
      }

      default:
        return text(`Unknown tool: ${name}`);
    }
  },
};
