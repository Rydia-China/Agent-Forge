import { listSkills } from "@/lib/services/skill-service";
import { getSkill } from "@/lib/services/skill-service";
import { registry } from "@/lib/mcp/registry";
import { appendSchemaDirectiveIfNeeded } from "@/lib/skills/required-schemas";

/* ------------------------------------------------------------------ */
/*  Static behavioural rules                                           */
/* ------------------------------------------------------------------ */

const RULES = `You are Agent Forge, an AI assistant with access to tools provided by MCP (Model Context Protocol) servers.

## Core Rules

### Skills
- Skills are system knowledge documents managed by the \`skills\` MCP.
- Always call \`skills__get\` to read full content **before** using related tools.
- Never create, update, or import skills unless the user explicitly asks.

### MCP Servers
Your tool list contains **active** MCPs only. Additional MCPs are listed under "Available MCPs" below.

- **Active MCPs** — their tools are in your tool list; call directly.
- **Available MCPs** — listed below but not in your tool list. Call via \`mcp_manager__use(provider, tool, args)\`. After first use, the MCP's tools appear in your tool list for direct calls.
- \`mcp_manager__use\` works for **any** MCP by name. Use \`mcp_manager__list\` to discover all MCPs in the system.

### Tool Call Memory
Previous tool results may be compressed: \`[memory] summary (recall:call_xxx)\`.
Use \`memory__recall\` only when the summary lacks detail you need.

### Error Handling
When a tool call fails, report the error to the user. Do not fabricate results.`;

/* ------------------------------------------------------------------ */
/*  System prompt: static rules + active MCP descriptions              */
/* ------------------------------------------------------------------ */

/**
 * Build the full system prompt.
 * Static rules + all MCP list + skill index.
 */
export async function buildSystemPrompt(
  preloadedSkills?: string[],
): Promise<string> {
  const parts: string[] = [RULES];

  // All MCP descriptions
  const mcpSection = await buildMcpSection(preloadedSkills);
  parts.push(mcpSection);

  return parts.join("\n\n");
}

/* ------------------------------------------------------------------ */
/*  All MCP description builder                                        */
/* ------------------------------------------------------------------ */

async function buildMcpSection(
  preloadedSkills?: string[],
): Promise<string> {
  const allProviders = registry.listProviders();
  const lines: string[] = ["## Active MCPs"];

  for (const provider of allProviders) {
    const name = provider.name;
    const tools = await provider.listTools();
    const toolNames = tools.map((t) => `\`${t.name}\``).join(", ");

    if (name === "skills") {
      lines.push(`### \`skills\``);
      lines.push(`Tools: ${toolNames}`);
      await appendSkillIndex(lines, preloadedSkills);
    } else {
      lines.push(`### \`${name}\``);
      lines.push(`Tools: ${toolNames}`);
    }
  }

  return lines.join("\n");
}

async function appendSkillIndex(lines: string[], preloadedSkills?: string[]): Promise<void> {
  const skills = await listSkills();
  if (skills.length === 0) return;

  lines.push("Available skills:");
  for (const s of skills) {
    lines.push(`- **${s.name}**: ${s.description}`);
  }

  // Append pre-loaded skill content inline (with requiredSchemas check)
  if (preloadedSkills?.length) {
    const loaded: string[] = [];
    for (const name of preloadedSkills) {
      const skill = await getSkill(name);
      if (skill) {
        const content = await appendSchemaDirectiveIfNeeded(
          skill.content,
          skill.metadata,
        );
        loaded.push(`#### ${skill.name}\n${content}`);
      }
    }
    if (loaded.length > 0) {
      lines.push("");
      lines.push("Pre-loaded skill content (no need to call `skills__get`):");
      lines.push(loaded.join("\n\n"));
    }
  }
}
