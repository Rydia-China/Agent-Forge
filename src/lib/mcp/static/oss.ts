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
          "从 URL 下载文件并上传到 OSS。并发处理多个文件，返回每个文件的状态（ok/error）和永久 OSS URL。单个文件也需要用数组格式。",
        inputSchema: {
          type: "object" as const,
          properties: {
            items: {
              type: "array",
              description: "要下载并上传的文件数组",
              items: {
                type: "object",
                properties: {
                  url: { type: "string", description: "源 URL" },
                  folder: { type: "string", description: 'OSS 文件夹名称（如 "image", "video", "file"）。默认："file"' },
                  filename: { type: "string", description: "目标文件名（省略则自动生成）" },
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
          "上传 base64 编码的内容到 OSS。返回永久 OSS URL。适用于直接上传 agent 生成的内容。",
        inputSchema: {
          type: "object" as const,
          properties: {
            data: {
              type: "string",
              description: "Base64 编码的文件内容",
            },
            filename: {
              type: "string",
              description: '目标文件名（含扩展名，如 "diagram.png"）',
            },
            folder: {
              type: "string",
              description: 'OSS 文件夹名称。默认："file"',
            },
          },
          required: ["data", "filename"],
        },
      },
      {
        name: "delete",
        description:
          "从 OSS 删除对象。并发处理多个对象，传入对象名称数组。单个删除也需要用数组格式。",
        inputSchema: {
          type: "object" as const,
          properties: {
            objectNames: {
              type: "array",
              items: { type: "string" },
              description: 'OSS 对象完整路径数组（如 ["public/image/1234-abc.png"]）',
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
