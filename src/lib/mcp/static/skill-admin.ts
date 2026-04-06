/**
 * skill_admin MCP — Skill management (CRUD) tools.
 *
 * Reading capabilities (list_skills, get_skill) are provided by the
 * skill protocol — this provider opts in via skillTools() + handleSkillTool().
 */

import type { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types";
import type { McpProvider } from "../types";
import * as svc from "@/lib/services/skill-service";
import { skillTools, handleSkillTool } from "../skill-protocol";

function text(t: string): CallToolResult {
  return { content: [{ type: "text", text: t }] };
}

function json(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

export const skillAdminMcp: McpProvider = {
  name: "skill_admin",

  async listTools(): Promise<Tool[]> {
    return [
      // Skill protocol: list_skills + get_skill
      ...skillTools(),
      // Management tools
      {
        name: "create",
        description: "Create a new skill (v1). Only use when the user EXPLICITLY asks to create a skill. NEVER call this to save notes, summaries, or information on your own initiative.",
        inputSchema: {
          type: "object" as const,
          properties: {
            name: { type: "string" },
            description: { type: "string" },
            content: { type: "string", description: "Markdown body (skill instructions)" },
            tags: { type: "array", items: { type: "string" } },
            provider: { type: "string", description: "MCP provider this skill belongs to (required)" },
          },
          required: ["name", "description", "content", "provider"],
        },
      },
      {
        name: "update",
        description: "Push a new version of an existing skill. Auto-promotes to production by default. Only use when the user EXPLICITLY asks to update a skill. NEVER call this to save notes, summaries, or information on your own initiative.",
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
        description: "Import a skill from standard SKILL.md content. Creates v1 if new, pushes new version if exists. Only use when the user EXPLICITLY asks to import a skill.",
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
    // Skill protocol: list_skills + get_skill
    const skillResult = handleSkillTool(name, args);
    if (skillResult) return skillResult;

    // Management tools
    switch (name) {
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
