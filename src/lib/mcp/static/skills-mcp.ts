import type { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpProvider } from "../types.js";
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
        name: "list",
        description:
          "List all skills metadata (name + description). Use for progressive disclosure / discovery.",
        inputSchema: {
          type: "object" as const,
          properties: {
            tag: { type: "string", description: "Optional tag to filter skills" },
          },
        },
      },
      {
        name: "get",
        description: "Get the full content of a skill by name (returns SKILL.md body).",
        inputSchema: {
          type: "object" as const,
          properties: { name: { type: "string", description: "Skill name" } },
          required: ["name"],
        },
      },
      {
        name: "create",
        description: "Create a new skill.",
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
        description: "Update an existing skill by name.",
        inputSchema: {
          type: "object" as const,
          properties: {
            name: { type: "string", description: "Skill to update" },
            description: { type: "string" },
            content: { type: "string" },
            tags: { type: "array", items: { type: "string" } },
          },
          required: ["name"],
        },
      },
      {
        name: "delete",
        description: "Delete a skill by name.",
        inputSchema: {
          type: "object" as const,
          properties: { name: { type: "string" } },
          required: ["name"],
        },
      },
      {
        name: "import",
        description: "Import a skill from standard SKILL.md content (YAML frontmatter + Markdown body).",
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
        description: "Export a skill as standard SKILL.md format (YAML frontmatter + Markdown body).",
        inputSchema: {
          type: "object" as const,
          properties: { name: { type: "string" } },
          required: ["name"],
        },
      },
    ];
  },

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<CallToolResult> {
    switch (name) {
      case "list": {
        const { tag } = svc.SkillListParams.parse(args);
        return json(await svc.listSkills(tag));
      }
      case "get": {
        const { name: n } = svc.SkillGetParams.parse(args);
        const skill = await svc.getSkill(n);
        if (!skill) return text(`Skill "${n}" not found`);
        return text(skill.content);
      }
      case "create": {
        const params = svc.SkillCreateParams.parse(args);
        const skill = await svc.createSkill(params);
        return text(`Created skill "${skill.name}"`);
      }
      case "update": {
        const params = svc.SkillUpdateParams.parse(args);
        const skill = await svc.updateSkill(params);
        return text(`Updated skill "${skill.name}"`);
      }
      case "delete": {
        const { name: n } = svc.SkillDeleteParams.parse(args);
        await svc.deleteSkill(n);
        return text(`Deleted skill "${n}"`);
      }
      case "import": {
        const params = svc.SkillImportParams.parse(args);
        const skill = await svc.importSkill(params);
        return text(`Imported skill "${skill.name}"`);
      }
      case "export": {
        const { name: n } = svc.SkillExportParams.parse(args);
        const md = await svc.exportSkill(n);
        if (!md) return text(`Skill "${n}" not found`);
        return text(md);
      }
      default:
        return text(`Unknown tool: ${name}`);
    }
  },
};
