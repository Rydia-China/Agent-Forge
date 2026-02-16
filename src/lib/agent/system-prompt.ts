import { listSkills } from "@/lib/services/skill-service";

const BASE_PROMPT = `You are Agent Forge, an AI assistant with access to tools provided by MCP (Model Context Protocol) servers.

You can manage skills (knowledge documents), dynamic MCP servers, and APIs (business database CRUD endpoints). Use the available tools to help the user.

## Behaviour
- Call tools when the user's request requires it.
- Available Skills are listed below. Use \`skills__get\` to read full skill content when you need details.
- Be concise and helpful.
- **NEVER create, update or import skills on your own initiative.** Skills are curated knowledge managed by the user. Do not write skills to store notes, summaries, or information you cannot find elsewhere.

## MCP On-demand Loading
Only core MCPs (skills, mcp_manager) are loaded by default. Business MCPs must be loaded on demand:
1. When you read a skill via \`skills__get\`, check the skill index below for \`requires_mcps\`.
2. Before using tools from a required MCP, call \`mcp_manager__load\` with the MCP name to activate it.
3. After loading, the MCP's tools become available immediately in the next tool call.
4. When you finish a task, you may call \`mcp_manager__unload\` to release unneeded MCPs.
5. Use \`mcp_manager__list_available\` to see what can be loaded.`

/**
 * Build system prompt with skill index injected.
 * Only skill names + descriptions are included (progressive disclosure).
 * Includes both DB skills and code-defined builtins.
 */
export async function buildSystemPrompt(): Promise<string> {
  const skills = await listSkills();
  const parts: string[] = [BASE_PROMPT];

  if (skills.length > 0) {
    const skillIndex = skills
      .map((s) => {
        const ver = s.productionVersion > 0 ? ` (v${s.productionVersion})` : "";
        const mcps = s.requiresMcps.length > 0 ? ` [needs: ${s.requiresMcps.join(", ")}]` : "";
        return `- **${s.name}**${ver}: ${s.description}${mcps}`;
      })
      .join("\n");
    parts.push(`## Available Skills\n${skillIndex}\n\nUse \`skills__get\` to read full skill content when needed. Load required MCPs via \`mcp_manager__load\` before using their tools.`);
  }

  return parts.join("\n\n");
}
