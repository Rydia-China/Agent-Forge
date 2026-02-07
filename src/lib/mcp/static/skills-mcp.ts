import type { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types";
import type { McpProvider } from "../types";
import * as svc from "@/lib/services/skill-service";

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
        description: "Get the full content of a skill by name (returns production version).",
        inputSchema: {
          type: "object" as const,
          properties: { name: { type: "string", description: "Skill name" } },
          required: ["name"],
        },
      },
      {
        name: "create",
        description: "Create a new skill (v1).",
        inputSchema: {
          type: "object" as const,
          properties: {
            name: { type: "string" },
            description: { type: "string" },
            content: { type: "string", description: "Markdown body (skill instructions)" },
            tags: { type: "array", items: { type: "string" } },
          },
          required: ["name", "description", "content"],
        },
      },
      {
        name: "update",
        description: "Push a new version of an existing skill. Auto-promotes to production by default.",
        inputSchema: {
          type: "object" as const,
          properties: {
            name: { type: "string", description: "Skill to update" },
            description: { type: "string" },
            content: { type: "string" },
            tags: { type: "array", items: { type: "string" } },
            promote: { type: "boolean", description: "Set new version as production (default: true)" },
          },
          required: ["name", "description", "content"],
        },
      },
      {
        name: "delete",
        description: "Delete a skill and all its versions.",
        inputSchema: {
          type: "object" as const,
          properties: { name: { type: "string" } },
          required: ["name"],
        },
      },
      {
        name: "import",
        description: "Import a skill from standard SKILL.md content. Creates v1 if new, pushes new version if exists.",
        inputSchema: {
          type: "object" as const,
          properties: {
            skillMd: { type: "string", description: "Full SKILL.md file content" },
            tags: { type: "array", items: { type: "string" } },
          },
          required: ["skillMd"],
        },
      },
      {
        name: "export",
        description: "Export a skill as standard SKILL.md format (production version).",
        inputSchema: {
          type: "object" as const,
          properties: { name: { type: "string" } },
          required: ["name"],
        },
      },
      {
        name: "list_versions",
        description: "List all versions of a skill, showing which is production.",
        inputSchema: {
          type: "object" as const,
          properties: { name: { type: "string" } },
          required: ["name"],
        },
      },
      {
        name: "set_production",
        description: "Set a specific version as the production version (rollback/promote).",
        inputSchema: {
          type: "object" as const,
          properties: {
            name: { type: "string" },
            version: { type: "number", description: "Version number to set as production" },
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
        const { name: n } = svc.SkillGetParams.parse(args);
        const skill = await svc.getSkill(n);
        if (!skill) return text(`Skill "${n}" not found`);
        return text(skill.content);
      }
      case "create": {
        const params = svc.SkillCreateParams.parse(args);
        const { skill } = await svc.createSkill(params);
        return text(`Created skill "${skill.name}" (v1)`);
      }
      case "update": {
        const params = svc.SkillUpdateParams.parse(args);
        const { skill, version } = await svc.updateSkill(params);
        const promoted = params.promote ? " (promoted to production)" : "";
        return text(`Pushed skill "${skill.name}" v${version.version}${promoted}`);
      }
      case "delete": {
        const { name: n } = svc.SkillDeleteParams.parse(args);
        await svc.deleteSkill(n);
        return text(`Deleted skill "${n}" and all versions`);
      }
      case "import": {
        const params = svc.SkillImportParams.parse(args);
        const result = await svc.importSkill(params);
        return text(`Imported skill "${result.skill.name}" v${result.version.version}`);
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
        return text(`Skill "${skill.name}" production set to v${skill.productionVersion}`);
      }
      default:
        return text(`Unknown tool: ${name}`);
    }
  },
};
