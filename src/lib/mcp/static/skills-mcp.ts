import type { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types";
import type { McpProvider } from "../types";
import * as svc from "@/lib/services/skill-service";
import { appendSchemaDirectiveIfNeeded } from "@/lib/required-schemas";

function text(t: string): CallToolResult {
  return { content: [{ type: "text", text: t }] };
}

function json(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

export const skillsMcp: McpProvider = {
  name: "skills",

  async listTools(): Promise<Tool[]> {
    return [
      {
        name: "get",
        description: "根据名称获取 skill 的完整内容（返回生产版本）。传入名称数组，单个 skill 也需要用数组格式。",
        inputSchema: {
          type: "object" as const,
          properties: {
            names: {
              type: "array",
              items: { type: "string" },
              description: "要获取的 skill 名称数组",
            },
          },
          required: ["names"],
        },
      },
      {
        name: "create",
        description: "创建新 skill（v1）。仅在用户明确要求创建 skill 时使用。禁止主动调用此工具保存笔记、摘要或信息。",
        inputSchema: {
          type: "object" as const,
          properties: {
            name: { type: "string" },
            description: { type: "string" },
            content: { type: "string", description: "Markdown 正文（skill 指令）" },
            tags: { type: "array", items: { type: "string" } },
          },
          required: ["name", "description", "content"],
        },
      },
      {
        name: "update",
        description: "推送现有 skill 的新版本。默认自动提升为生产版本。仅在用户明确要求更新 skill 时使用。禁止主动调用此工具保存笔记、摘要或信息。",
        inputSchema: {
          type: "object" as const,
          properties: {
            name: { type: "string", description: "要更新的 skill 名称" },
            description: { type: "string" },
            content: { type: "string" },
            tags: { type: "array", items: { type: "string" } },
            promote: { type: "boolean", description: "将新版本设为生产版本（默认：true）" },
          },
          required: ["name", "description", "content"],
        },
      },
      {
        name: "delete",
        description: "删除 skill 及其所有版本。",
        inputSchema: {
          type: "object" as const,
          properties: { name: { type: "string" } },
          required: ["name"],
        },
      },
      {
        name: "import",
        description: "从标准 SKILL.md 内容导入 skill。如果是新 skill 则创建 v1，如果已存在则推送新版本。仅在用户明确要求导入 skill 时使用。",
        inputSchema: {
          type: "object" as const,
          properties: {
            skillMd: { type: "string", description: "完整的 SKILL.md 文件内容" },
            tags: { type: "array", items: { type: "string" } },
          },
          required: ["skillMd"],
        },
      },
      {
        name: "export",
        description: "将 skill 导出为标准 SKILL.md 格式（生产版本）。",
        inputSchema: {
          type: "object" as const,
          properties: { name: { type: "string" } },
          required: ["name"],
        },
      },
      {
        name: "list_versions",
        description: "列出 skill 的所有版本，显示哪个是生产版本。",
        inputSchema: {
          type: "object" as const,
          properties: { name: { type: "string" } },
          required: ["name"],
        },
      },
      {
        name: "set_production",
        description: "将指定版本设为生产版本（回滚/提升）。",
        inputSchema: {
          type: "object" as const,
          properties: {
            name: { type: "string" },
            version: { type: "number", description: "要设为生产版本的版本号" },
          },
          required: ["name", "version"],
        },
      },
    ];
  },

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<CallToolResult> {
    switch (name) {
      case "get": {
        const names = args.names as string[];
        if (!Array.isArray(names) || names.length === 0) return text("Missing names parameter.");
        const results = await Promise.allSettled(
          names.map(async (n) => {
            const skill = await svc.getSkill(n);
            if (!skill) throw new Error(`Skill "${n}" not found`);

            const content = await appendSchemaDirectiveIfNeeded(
              skill.content,
              skill.metadata,
            );

            return { name: n, content };
          }),
        );
        const output = results.map((r, i) =>
          r.status === "fulfilled"
            ? { status: "ok" as const, ...r.value }
            : { status: "error" as const, name: names[i], error: r.reason instanceof Error ? r.reason.message : String(r.reason) },
        );
        return json(output);
      }
      case "create": {
        const params = svc.SkillCreateParams.parse(args);
        const { skill } = await svc.createSkill(params);
        return text(`Created skill "${skill.name}" (v1)`);
      }
      case "update": {
        const params = svc.SkillUpdateParams.parse(args);
        const { skill } = await svc.updateSkill(params);
        const promoted = params.promote ? " (promoted to production)" : "";
        return text(`Pushed skill "${skill.name}" v${skill.version}${promoted}`);
      }
      case "delete": {
        const { name: n } = svc.SkillDeleteParams.parse(args);
        await svc.deleteSkill(n);
        return text(`Deleted skill "${n}" and all versions`);
      }
      case "import": {
        const params = svc.SkillImportParams.parse(args);
        const result = await svc.importSkill(params);
        return text(`Imported skill "${result.skill.name}" v${result.skill.version}`);
      }
      case "export": {
        const { name: n } = svc.SkillExportParams.parse(args);
        const md = await svc.exportSkill(n);
        if (!md) return text(`Skill "${n}" not found`);
        return text(md);
      }
      case "list_versions": {
        const { name: n } = svc.SkillGetParams.parse(args);
        const versions = await svc.listSkillVersions(n);
        return json(versions);
      }
      case "set_production": {
        const { name: n, version } = svc.SkillSetProductionParams.parse(args);
        const skill = await svc.setSkillProduction(n, version);
        return text(`Skill "${skill.name}" production set to v${skill.version}`);
      }
      default:
        return text(`Unknown tool: ${name}`);
    }
  },
};
