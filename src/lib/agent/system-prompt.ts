import { listSkills } from "@/lib/services/skill-service";
import { listApis } from "@/lib/services/api-service";

const BASE_PROMPT = `You are Agent Forge, an AI assistant with access to tools provided by MCP (Model Context Protocol) servers.

You can manage skills (knowledge documents), dynamic MCP servers, and APIs (business database CRUD endpoints). Use the available tools to help the user.

## Behaviour
- Call tools when the user's request requires it.
- Available Skills are listed below. Use \`skills__get\` to read full skill content when the user needs details.
- Available APIs are listed below. Use \`apis__get\` to read API details (operations, schema). Use \`apis__call\` to invoke API operations.
- Be concise and helpful.
- **NEVER create, update or import skills on your own initiative.** Skills are curated knowledge managed by the user. Do not write skills to store notes, summaries, or information you cannot find elsewhere.`

/**
 * Build system prompt with skill index injected.
 * Only skill names + descriptions are included (progressive disclosure).
 * Includes both DB skills and code-defined builtins.
 */
export async function buildSystemPrompt(): Promise<string> {
  const skills = await listSkills();

  const apis = await listApis();
  const enabledApis = apis.filter((a) => a.enabled);

  const parts: string[] = [BASE_PROMPT];

  if (skills.length > 0) {
    const skillIndex = skills
      .map((s) => {
        const ver = s.productionVersion > 0 ? ` (v${s.productionVersion})` : "";
        return `- **${s.name}**${ver}: ${s.description}`;
      })
      .join("\n");
    parts.push(`## Available Skills\n${skillIndex}\n\nUse \`skills__get\` to read full skill content when needed.`);
  }

  if (enabledApis.length > 0) {
    const apiIndex = enabledApis
      .map((a) => `- **${a.name}** (v${a.productionVersion}): ${a.description}`)
      .join("\n");
    parts.push(`## Available APIs\n${apiIndex}\n\nUse \`apis__get\` to read API details. Use \`apis__call\` to invoke operations.`);
  }

  return parts.join("\n\n");
}
