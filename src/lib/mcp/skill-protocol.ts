/**
 * Skill Protocol — convention-based skill reading capability.
 *
 * Any McpProvider can become "skill-aware" by:
 *   1. Spreading `skillTools()` into its tool list
 *   2. Calling `handleSkillTool()` at the top of its `callTool` method
 *
 * This is NOT a wrapper/mixin — providers explicitly opt in and retain full control.
 */

import type { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types";
import * as svc from "@/lib/services/skill-service";
import { appendSchemaDirectiveIfNeeded } from "@/lib/skills/required-schemas";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface SkillProtocolOptions {
  /** MCP provider name. When set, `list_skills` returns this provider's skills + global. */
  provider?: string;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function text(t: string): CallToolResult {
  return { content: [{ type: "text", text: t }] };
}

function json(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

/* ------------------------------------------------------------------ */
/*  Tool definitions                                                   */
/* ------------------------------------------------------------------ */

/**
 * Returns the two skill-protocol tool definitions: `list_skills` and `get_skill`.
 * Spread these into your provider's tool array.
 */
export function skillTools(_options?: SkillProtocolOptions): Tool[] {
  return [
    {
      name: "list_skills",
      description:
        "List available skills (name + description). " +
        "Use this to discover what skills are available before reading one.",
      inputSchema: {
        type: "object" as const,
        properties: {
          tag: {
            type: "string",
            description: "Optional tag filter",
          },
        },
      },
    },
    {
      name: "get_skill",
      description:
        "Get the full content of skill(s) by name (returns production version). " +
        "Pass an array of names. For a single skill, pass a one-element array.",
      inputSchema: {
        type: "object" as const,
        properties: {
          names: {
            type: "array",
            items: { type: "string" },
            description: "Array of skill names to fetch",
          },
        },
        required: ["names"],
      },
    },
  ];
}

/* ------------------------------------------------------------------ */
/*  Tool handler                                                       */
/* ------------------------------------------------------------------ */

/**
 * Handle a skill-protocol tool call.
 * Returns a `Promise<CallToolResult>` if the tool name matches, or `null` otherwise.
 *
 * Usage in callTool:
 * ```
 * const r = handleSkillTool(name, args, options);
 * if (r) return r;
 * // ... handle domain tools
 * ```
 */
export function handleSkillTool(
  name: string,
  args: Record<string, unknown>,
  options?: SkillProtocolOptions,
): Promise<CallToolResult> | null {
  switch (name) {
    case "list_skills":
      return handleListSkills(args, options);
    case "get_skill":
      return handleGetSkill(args);
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Implementation                                                     */
/* ------------------------------------------------------------------ */

async function handleListSkills(
  args: Record<string, unknown>,
  options?: SkillProtocolOptions,
): Promise<CallToolResult> {
  const requestTag = typeof args.tag === "string" ? args.tag : undefined;

  const skills = await svc.listSkills({
    tag: requestTag,
    provider: options?.provider,
  });

  return json(
    skills.map((s) => ({
      name: s.name,
      description: s.description,
      tags: s.tags,
    })),
  );
}

async function handleGetSkill(
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const names = args.names as string[];
  if (!Array.isArray(names) || names.length === 0) {
    return text("Missing names parameter.");
  }

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
      : {
          status: "error" as const,
          name: names[i],
          error:
            r.reason instanceof Error
              ? r.reason.message
              : String(r.reason),
        },
  );
  return json(output);
}
