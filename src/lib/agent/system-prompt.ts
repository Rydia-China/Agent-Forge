import { listSkills } from "@/lib/services/skill-service";
import { getSkill } from "@/lib/services/skill-service";
import { listMcpServers } from "@/lib/services/mcp-service";
import { registry } from "@/lib/mcp/registry";
import { getCatalogEntries } from "@/lib/mcp/catalog";
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
- \`mcp_manager__use\` works for **any** MCP by name — including ones not listed below (e.g. newly created Dynamic MCPs). Use \`mcp_manager__list\` to discover all MCPs in the system.
- **Dynamic MCPs** — User-created JS code stored in DB. Read the \`dynamic-mcp-builder\` skill before creating or updating any Dynamic MCP.

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
 * Static rules + active MCP list + available MCP catalog + skill index.
 */
export async function buildSystemPrompt(
  preloadedSkills?: string[],
  activeScope?: Set<string>,
): Promise<string> {
  const parts: string[] = [RULES];

  // Active MCP descriptions + available MCP catalog
  const mcpSection = await buildMcpSection(preloadedSkills, activeScope);
  parts.push(mcpSection);

  return parts.join("\n\n");
}

/* ------------------------------------------------------------------ */
/*  Active MCP description builder                                     */
/* ------------------------------------------------------------------ */

async function buildMcpSection(
  preloadedSkills?: string[],
  activeScope?: Set<string>,
): Promise<string> {
  const activeNames = activeScope ?? new Set(registry.listProviders().map((p) => p.name));
  const lines: string[] = ["## Active MCPs"];

  for (const name of activeNames) {
    const provider = registry.getProvider(name);
    if (!provider) continue;
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

  // Available MCPs (not in active scope) — listed as catalog for mcp_manager__use
  await appendAvailableCatalog(lines, activeNames);

  return lines.join("\n");
}

/* ------------------------------------------------------------------ */
/*  Available MCP catalog (for mcp_manager__use)                       */
/* ------------------------------------------------------------------ */

async function appendAvailableCatalog(
  lines: string[],
  activeNames: Set<string>,
): Promise<void> {
  const available: { name: string; tools: string[] }[] = [];

  // Catalog MCPs: can get tool names without loading (TS modules)
  for (const entry of getCatalogEntries()) {
    if (!entry.available || activeNames.has(entry.name)) continue;
    const tools = await entry.provider.listTools();
    available.push({
      name: entry.name,
      tools: tools.map((t) => t.name),
    });
  }

  // Dynamic MCPs from DB (name + description only, no tool names)
  try {
    const dbServers = await listMcpServers();
    for (const s of dbServers) {
      if (!s.enabled || activeNames.has(s.name)) continue;
      available.push({ name: s.name, tools: [] });
    }
  } catch {
    // DB may be unavailable during initial prompt build
  }

  if (available.length === 0) return;

  lines.push("");
  lines.push("## Available MCPs (call via `mcp_manager__use`)");
  for (const mcp of available) {
    const toolInfo = mcp.tools.length > 0
      ? `: \`${mcp.tools.join("\`, \`")}\``
      : "";
    lines.push(`- **${mcp.name}**${toolInfo}`);
  }
}

async function appendSkillIndex(lines: string[], preloadedSkills?: string[]): Promise<void> {
  const skills = await listSkills();
  if (skills.length === 0) return;

  lines.push("Available skills:");
  for (const s of skills) {
    const mcps = s.requiresMcps.length > 0 ? ` [needs: ${s.requiresMcps.map((m) => `\`${m}\``).join(", ")}]` : "";
    lines.push(`- **${s.name}**: ${s.description}${mcps}`);
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
