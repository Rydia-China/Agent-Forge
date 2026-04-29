import type { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types";
import type { McpProvider } from "../types";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { resolveModel } from "@/lib/agent/models";
import { submitSubAgent, getSubAgent } from "@/lib/services/subagent-service";
import { NovelContextProvider } from "@/lib/video/novel-context-provider";
import { VideoContextProvider } from "@/lib/video/context-provider";

/* ================================================================== */
/*  Shared helpers                                                     */
/* ================================================================== */

function text(t: string): CallToolResult {
  return { content: [{ type: "text", text: t }] };
}

function json(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

/* ================================================================== */
/*  1. request_upload (from ui.ts)                                    */
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

const SubmitMainServiceAgentParams = z.object({
  message: z.string().min(1),
  sessionId: z.string().optional(),
  user: z.string().optional(),
  images: z.array(z.string()).optional(),
  model: z.string().optional(),
  skills: z.array(z.string()).optional(),
  mcpScope: z.array(z.string()).optional(),
});

const SubmitNovelAgentParams = z.object({
  novelId: z.string().min(1),
  message: z.string().min(1),
  sessionId: z.string().optional(),
  user: z.string().optional(),
  images: z.array(z.string()).optional(),
  model: z.string().optional(),
  skills: z.array(z.string()).optional(),
  mcpScope: z.array(z.string()).optional(),
});

const SubmitEpAgentParams = z.object({
  novelId: z.string().min(1),
  scriptId: z.string().min(1),
  scriptKey: z.string().min(1),
  message: z.string().min(1),
  sessionId: z.string().optional(),
  user: z.string().optional(),
  images: z.array(z.string()).optional(),
  model: z.string().optional(),
  skills: z.array(z.string()).optional(),
  mcpScope: z.array(z.string()).optional(),
});

const GetSystemAgentStatusParams = z.object({
  subagentId: z.string().min(1),
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
function agentSubmitResult(
  agentType: "main_service_agent" | "novel_agent" | "ep_agent",
  result: { subagentId: string; sessionId: string },
): CallToolResult {
  return json({
    agentType,
    subagent_id: result.subagentId,
    task_id: result.subagentId,
    session_id: result.sessionId,
    status_url: `/api/subagents/${result.subagentId}`,
    events_url: `/api/subagents/${result.subagentId}/events`,
    session_url: `/api/sessions/${result.sessionId}`,
  });
}



/* ================================================================== */
/*  Provider                                                           */
/* ================================================================== */

export const agentForgeMcp: McpProvider = {
  name: "agent_forge",

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
      {
        name: "submit_main_service_agent",
        description:
          "启动主服务 agent。等价于 UI/REST 的 POST /api/subagents；用于普通 Agent-Forge 主会话，不注入小说或 EP 上下文。返回 subagent_id、session_id、events_url。",
        inputSchema: {
          type: "object" as const,
          properties: {
            message: { type: "string", description: "发送给主服务 agent 的用户消息" },
            sessionId: { type: "string", description: "可选：继续已有 session" },
            user: { type: "string", description: "可选：用户/会话 scope" },
            images: { type: "array", items: { type: "string" }, description: "可选：图片 URL" },
            model: { type: "string", description: "可选：模型 ID" },
            skills: { type: "array", items: { type: "string" }, description: "可选：预注入 skills" },
            mcpScope: { type: "array", items: { type: "string" }, description: "可选：限制可见 MCP providers" },
          },
          required: ["message"],
        },
      },
      {
        name: "submit_novel_agent",
        description:
          "启动小说 agent。等价于 /video 小说级 UI agent，注入 NovelContextProvider；用于小说级角色立绘、场景等共享资源管理。返回 subagent_id、session_id、events_url。",
        inputSchema: {
          type: "object" as const,
          properties: {
            novelId: { type: "string", description: "Novel ID" },
            message: { type: "string", description: "发送给小说 agent 的用户消息" },
            sessionId: { type: "string", description: "可选：继续已有 session" },
            user: { type: "string", description: "可选：用户/会话 scope；默认 video:{novelId}" },
            images: { type: "array", items: { type: "string" }, description: "可选：图片 URL" },
            model: { type: "string", description: "可选：模型 ID" },
            skills: { type: "array", items: { type: "string" }, description: "可选：skills；默认 [novel-resource-mgr]" },
            mcpScope: { type: "array", items: { type: "string" }, description: "可选：限制可见 MCP providers；默认 [video_workflow]" },
          },
          required: ["novelId", "message"],
        },
      },
      {
        name: "submit_ep_agent",
        description:
          "启动 EP agent。等价于 /video 具体 EP 的 UI agent，注入 VideoContextProvider；用于 EP 级换装、Prompt Writer/Reviewer 闭环和 reviewed prompts。返回 subagent_id、session_id、events_url。",
        inputSchema: {
          type: "object" as const,
          properties: {
            novelId: { type: "string", description: "Novel ID" },
            scriptId: { type: "string", description: "Episode script DB ID" },
            scriptKey: { type: "string", description: "Episode script key，如 EP1" },
            message: { type: "string", description: "发送给 EP agent 的用户消息" },
            sessionId: { type: "string", description: "可选：继续已有 session" },
            user: { type: "string", description: "可选：用户/会话 scope；默认 video:{novelId}:{scriptKey}" },
            images: { type: "array", items: { type: "string" }, description: "可选：图片 URL" },
            model: { type: "string", description: "可选：模型 ID" },
            skills: { type: "array", items: { type: "string" }, description: "可选：skills；默认 [video-workflow]" },
            mcpScope: { type: "array", items: { type: "string" }, description: "可选：限制可见 MCP providers；默认 [video_workflow, subagent]" },
          },
          required: ["novelId", "scriptId", "scriptKey", "message"],
        },
      },
      {
        name: "get_system_agent_status",
        description:
          "查询由 submit_main_service_agent / submit_novel_agent / submit_ep_agent 启动的系统 agent 状态。事件流仍通过返回的 events_url 获取。",
        inputSchema: {
          type: "object" as const,
          properties: {
            subagentId: { type: "string", description: "系统 agent 的 subagent_id" },
          },
          required: ["subagentId"],
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
          uploadId: uuidv4(),
          ...params,
        };
        return uploadResult(req);
      }

      case "submit_main_service_agent": {
        const params = SubmitMainServiceAgentParams.parse(args);
        const result = await submitSubAgent({
          message: params.message,
          sessionId: params.sessionId,
          user: params.user,
          images: params.images,
          model: resolveModel(params.model),
          agentConfig: params.skills || params.mcpScope ? {
            skills: params.skills,
            mcpScope: params.mcpScope,
          } : undefined,
        });
        return agentSubmitResult("main_service_agent", result);
      }

      case "submit_novel_agent": {
        const params = SubmitNovelAgentParams.parse(args);
        const result = await submitSubAgent({
          message: params.message,
          sessionId: params.sessionId,
          user: params.user ?? `video:${params.novelId}`,
          images: params.images,
          model: resolveModel(params.model),
          agentConfig: {
            contextProvider: new NovelContextProvider({ novelId: params.novelId }),
            skills: params.skills ?? ["novel-resource-mgr"],
            mcpScope: params.mcpScope ?? ["video_workflow"],
          },
        });
        return agentSubmitResult("novel_agent", result);
      }

      case "submit_ep_agent": {
        const params = SubmitEpAgentParams.parse(args);
        const result = await submitSubAgent({
          message: params.message,
          sessionId: params.sessionId,
          user: params.user ?? `video:${params.novelId}:${params.scriptKey}`,
          images: params.images,
          model: resolveModel(params.model),
          agentConfig: {
            contextProvider: new VideoContextProvider({
              novelId: params.novelId,
              scriptId: params.scriptId,
              scriptKey: params.scriptKey,
            }),
            skills: params.skills ?? ["video-workflow"],
            mcpScope: params.mcpScope ?? ["video_workflow", "subagent"],
          },
        });
        return agentSubmitResult("ep_agent", result);
      }

      case "get_system_agent_status": {
        const params = GetSystemAgentStatusParams.parse(args);
        const subagent = await getSubAgent(params.subagentId);
        if (!subagent) {
          return json({ status: "not_found", subagent_id: params.subagentId });
        }
        return json({
          ...subagent,
          subagent_id: subagent.id,
          task_id: subagent.id,
          status_url: `/api/subagents/${subagent.id}`,
          events_url: `/api/subagents/${subagent.id}/events`,
          session_url: `/api/sessions/${subagent.sessionId}`,
        });
      }

      default:
        return text(`Unknown tool: ${name}`);
    }
  },
};
