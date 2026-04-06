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
- Skills are system knowledge documents. Each MCP that supports skills exposes \`list_skills\` and \`get_skill\` tools.
- Always call \`get_skill\` to read full content **before** using related tools.
- **Pre-loaded skills** (marked \`[Pre-loaded]\` below) are already fully included in this prompt. Do NOT call \`get_skill\` for them.
- Skill management (create/update/delete) requires the \`skill_admin\` MCP (available via \`mcp_manager__use\`).
- Never create, update, or import skills unless the user explicitly asks.

### MCP Servers
Your tool list contains **core** MCPs only (mcp_manager, ui, sync, subagent). All other MCPs are called via \`mcp_manager__use\`.

- **Core MCPs** — their tools are in your tool list; call directly.
- **Other MCPs** — listed under "Available MCPs" below. Always call via \`mcp_manager__use(provider, tool, args)\`.
- \`mcp_manager__use\` works for **any** MCP by name — including ones not listed below (e.g. newly created Dynamic MCPs). Use \`mcp_manager__list\` to discover all MCPs in the system.
- **Dynamic MCPs** — User-created JS code stored in DB. Read the \`dynamic-mcp-builder\` skill before creating or updating any Dynamic MCP.

### SubAgent Delegation
For prompt-driven tasks and multi-step business operations, **delegate to subagents** instead of calling tools directly.
- \`subagent__run\` — dispatch tasks and wait for results. Supports concurrent batch execution. Mode is determined by \`mcpScope\`:
  - **Omit mcpScope** → single-shot mode: one LLM call, ideal for prompt execution, JSON generation, and multimodal analysis. Supports \`outputSchema\` for validated structured output.
  - **Specify mcpScope** → tool-loop mode: multi-iteration agent with its own tools, ideal for complex business operations.
- \`subagent__run_async\` — dispatch long-running tasks, continue working, check results later with \`subagent__get_result\`.
- \`subagent__continue\` — send follow-up feedback to an existing subagent (by \`agentId\`). The subagent retains its full conversation history and continues execution.
- \`subagent__get_trace\` — inspect a subagent's full execution trace (message history, tool calls, system prompt) for debugging. Use when a subagent fails and you need to understand why.
- \`subagent__schedule\` — schedule future or recurring tasks.
- If a subagent fails, use \`subagent__get_trace\` to inspect the trace, then either \`subagent__continue\` with corrective feedback or retry with adjusted parameters.
- **Async result collection**: after calling \`subagent__run_async\`, you **must** collect all results with \`subagent__get_result\` (use \`subagent__wait\` if needed) before ending your reply. Uncollected results are lost to the conversation.
- **Direct tool calls are still appropriate for**: quick data reads, skill retrieval, and any situation where a single tool call suffices.

### Error Handling
When a tool call fails, report the error to the user. Do not fabricate results.`;

/* ------------------------------------------------------------------ */
/*  System prompt: static rules + active MCP descriptions              */
/* ------------------------------------------------------------------ */

/**
 * Build the full system prompt.
 * Static rules + injected skill instructions + active MCP list + skill index.
 *
 * Skills listed in `injectedSkills` are:
 *   1. Rendered as top-level sections (between RULES and MCP section)
 *   2. Excluded from the skill index so the LLM won't try `get_skill`
 */
export async function buildSystemPrompt(
  injectedSkills?: string[],
): Promise<string> {
  const parts: string[] = [RULES];

  // Inject skill content as top-level system prompt sections
  if (injectedSkills?.length) {
    const skillSections = await buildInjectedSkillSections(injectedSkills);
    if (skillSections) parts.push(skillSections);
  }

  // Core MCP descriptions + available MCP catalog
  const mcpSection = await buildMcpSection(injectedSkills);
  parts.push(mcpSection);

  return parts.join("\n\n");
}

/* ------------------------------------------------------------------ */
/*  Active MCP description builder                                     */
/* ------------------------------------------------------------------ */

const CORE_MCPS = new Set(["mcp_manager", "ui", "sync", "subagent"]);

async function buildMcpSection(
  injectedSkills?: string[],
): Promise<string> {
  const lines: string[] = ["## Core MCPs"];

  for (const name of CORE_MCPS) {
    const provider = registry.getProvider(name);
    if (!provider) continue;
    const tools = await provider.listTools();
    const toolNames = tools.map((t) => `\`${t.name}\``).join(", ");
    lines.push(`### \`${name}\``);
    lines.push(`Tools: ${toolNames}`);
  }

  // Available MCPs (not core) — listed as catalog for mcp_manager__use
  await appendAvailableCatalog(lines, CORE_MCPS);

  // Skill index — standalone section, not tied to any specific provider
  await appendSkillIndex(lines, injectedSkills);

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

async function appendSkillIndex(lines: string[], injectedSkills?: string[]): Promise<void> {
  const skills = await listSkills();
  if (skills.length === 0) return;

  // Exclude already-injected skills from the index
  const injectedSet = new Set(injectedSkills ?? []);
  const available = skills.filter((s) => !injectedSet.has(s.name));
  if (available.length === 0) return;

  lines.push("");
  lines.push("## Skills");
  lines.push("Call `get_skill` (available in your active MCP) to read full content.");
  for (const s of available) {
    const mcps = s.requiresMcps.length > 0 ? ` [needs: ${s.requiresMcps.map((m) => `\`${m}\``).join(", ")}]` : "";
    lines.push(`- **${s.name}**: ${s.description}${mcps}`);
  }
}

/* ------------------------------------------------------------------ */
/*  Injected skill sections (top-level system prompt)                   */
/* ------------------------------------------------------------------ */

/**
 * Resolve skill names and concatenate their content as top-level prompt sections.
 * These become part of the system prompt itself — mandatory agent instructions,
 * not optional reference material.
 */
async function buildInjectedSkillSections(
  skillNames: string[],
): Promise<string | undefined> {
  const sections: string[] = [];
  for (const name of skillNames) {
    const skill = await getSkill(name);
    if (!skill) {
      console.warn(`[system-prompt] Skill "${name}" not found, skipping injection`);
      continue;
    }
    const content = await appendSchemaDirectiveIfNeeded(
      skill.content,
      skill.metadata,
    );
    sections.push(`<!-- [Pre-loaded] ${name} — do NOT call get_skill for this -->\n${content}`);
  }
  return sections.length > 0 ? sections.join("\n\n") : undefined;
}
