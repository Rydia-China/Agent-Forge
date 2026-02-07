import { listSkills } from "@/lib/services/skill-service";

const BASE_PROMPT = `You are Agent Forge, an AI assistant with access to tools provided by MCP (Model Context Protocol) servers.

You can manage skills (knowledge documents) and dynamic MCP servers. Use the available tools to help the user.

## Behaviour
- Call tools when the user's request requires it.
- Available Skills are listed below. Use \`skills__get\` to read full skill content when the user needs details.
- Be concise and helpful.`;

/**
 * Build system prompt with skill index injected.
 * Only skill names + descriptions are included (progressive disclosure).
 * Includes both DB skills and code-defined builtins.
 */
export async function buildSystemPrompt(): Promise<string> {
  const skills = await listSkills();

  if (skills.length === 0) return BASE_PROMPT;

  const index = skills
    .map((s) => `- **${s.name}**: ${s.description}`)
    .join("\n");

  return `${BASE_PROMPT}

## Available Skills
${index}

Use \`skills__get\` to read full skill content when needed.`;
}
