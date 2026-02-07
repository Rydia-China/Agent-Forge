import type { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpProvider } from "../types.js";
import { prisma } from "@/lib/db";
import matter from "gray-matter";

/** Parse a standard SKILL.md string into structured fields */
function parseSkillMd(raw: string) {
  const { data, content } = matter(raw);
  return {
    name: String(data.name ?? ""),
    description: String(data.description ?? ""),
    content: content.trim(),
    metadata: data.metadata ?? null,
  };
}

/** Export DB skill to standard SKILL.md format */
function toSkillMd(skill: {
  name: string;
  description: string;
  content: string;
  metadata?: unknown;
}): string {
  const fm: Record<string, unknown> = {
    name: skill.name,
    description: skill.description,
  };
  if (skill.metadata) fm.metadata = skill.metadata;
  return matter.stringify(skill.content, fm);
}

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
            tag: {
              type: "string",
              description: "Optional tag to filter skills",
            },
          },
        },
      },
      {
        name: "get",
        description:
          "Get the full content of a skill by name (returns SKILL.md body).",
        inputSchema: {
          type: "object" as const,
          properties: {
            name: { type: "string", description: "Skill name" },
          },
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
            content: {
              type: "string",
              description: "Markdown body (skill instructions)",
            },
            tags: {
              type: "array",
              items: { type: "string" },
            },
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
          properties: {
            name: { type: "string" },
          },
          required: ["name"],
        },
      },
      {
        name: "import",
        description:
          "Import a skill from standard SKILL.md content (YAML frontmatter + Markdown body).",
        inputSchema: {
          type: "object" as const,
          properties: {
            skillMd: {
              type: "string",
              description: "Full SKILL.md file content",
            },
            tags: { type: "array", items: { type: "string" } },
          },
          required: ["skillMd"],
        },
      },
      {
        name: "export",
        description:
          "Export a skill as standard SKILL.md format (YAML frontmatter + Markdown body).",
        inputSchema: {
          type: "object" as const,
          properties: {
            name: { type: "string" },
          },
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
        const tag = args.tag as string | undefined;
        const skills = await prisma.skill.findMany({
          where: tag ? { tags: { has: tag } } : undefined,
          select: { name: true, description: true, tags: true },
          orderBy: { name: "asc" },
        });
        return json(skills);
      }

      case "get": {
        const skill = await prisma.skill.findUnique({
          where: { name: args.name as string },
        });
        if (!skill) return text(`Skill "${args.name}" not found`);
        return text(skill.content);
      }

      case "create": {
        const skill = await prisma.skill.create({
          data: {
            name: args.name as string,
            description: args.description as string,
            content: args.content as string,
            tags: (args.tags as string[]) ?? [],
          },
        });
        return text(`Created skill "${skill.name}"`);
      }

      case "update": {
        const data: Record<string, unknown> = {};
        if (args.description !== undefined) data.description = args.description;
        if (args.content !== undefined) data.content = args.content;
        if (args.tags !== undefined) data.tags = args.tags;
        const skill = await prisma.skill.update({
          where: { name: args.name as string },
          data,
        });
        return text(`Updated skill "${skill.name}"`);
      }

      case "delete": {
        await prisma.skill.delete({
          where: { name: args.name as string },
        });
        return text(`Deleted skill "${args.name}"`);
      }

      case "import": {
        const parsed = parseSkillMd(args.skillMd as string);
        if (!parsed.name) return text("SKILL.md missing 'name' in frontmatter");
        const skill = await prisma.skill.upsert({
          where: { name: parsed.name },
          create: {
            ...parsed,
            tags: (args.tags as string[]) ?? [],
          },
          update: {
            ...parsed,
            tags: (args.tags as string[]) ?? undefined,
          },
        });
        return text(`Imported skill "${skill.name}"`);
      }

      case "export": {
        const skill = await prisma.skill.findUnique({
          where: { name: args.name as string },
        });
        if (!skill) return text(`Skill "${args.name}" not found`);
        return text(toSkillMd(skill));
      }

      default:
        return text(`Unknown tool: ${name}`);
    }
  },
};
