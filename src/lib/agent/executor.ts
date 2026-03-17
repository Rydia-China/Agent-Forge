import { registry } from "@/lib/mcp/registry";
import { initMcp } from "@/lib/mcp/init";
import { isCatalogEntry, loadFromCatalog } from "@/lib/mcp/catalog";
import { sandboxManager } from "@/lib/mcp/sandbox";
import * as mcpService from "@/lib/services/mcp-service";
import { getSkill } from "@/lib/services/skill-service";
import { appendSchemaDirectiveIfNeeded } from "@/lib/skills/required-schemas";
import {
  chatCompletion,
  mcpToolToOpenAI,
  type LlmMessage,
} from "./llm-client";
import type { ToolContext } from "@/lib/mcp/types";

/* ------------------------------------------------------------------ */
/*  Executor model — independent from controller model list            */
/* ------------------------------------------------------------------ */

export const EXECUTOR_DEFAULT_MODEL =
  process.env.EXECUTOR_MODEL ?? "x-ai/grok-code-fast-1";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface ExecutorTask {
  /** Concrete instruction — what to do, not why. */
  instruction: string;
  /** MCP provider names whose tools are available to this executor. */
  mcpScope: string[];
  /** LLM model to use. Defaults to system default (Sonnet). */
  model?: string;
  /** Max tool-use iterations before forced stop. Default 20. */
  maxIterations?: number;
  /** Optional additional context injected into the system prompt. */
  context?: string;
  /**
   * Skill names whose content is transparently injected into the system prompt
   * as reference material. The executor never sees the concept of "skills".
   */
  skills?: string[];
}

export interface ExecutorResult {
  status: "completed" | "failed" | "max_iterations";
  /** Final text output from the executor. */
  output: string;
  error?: string;
  /** Total tool calls made during execution. */
  toolCallCount: number;
  /** Model actually used. */
  model: string;
  /** Wall-clock duration in milliseconds. */
  durationMs: number;
}

/* ------------------------------------------------------------------ */
/*  System prompt                                                      */
/* ------------------------------------------------------------------ */

const EXECUTOR_RULES = `You are an Executor agent. Your job is to complete the given task by calling the available tools.

Rules:
- Follow the instruction precisely
- Use only the tools available to you
- When finished, provide a concise summary of what you accomplished
- Do not ask questions — execute the task
- If a tool call fails, try an alternative approach before giving up
- If you cannot complete the task, you MUST clearly report:
  1. What you attempted and what failed
  2. The specific reason for failure
  3. What information or resources you would need to succeed
  This information is critical — the controller will use it to retry with the right inputs.`;

function buildExecutorSystemPrompt(context?: string, skillContent?: string): string {
  const parts: string[] = [EXECUTOR_RULES];
  if (skillContent) parts.push(`## Reference Material\n${skillContent}`);
  if (context) parts.push(`## Additional Context\n${context}`);
  return parts.join("\n\n");
}

/* ------------------------------------------------------------------ */
/*  Skill content resolution (transparent to executor)                  */
/* ------------------------------------------------------------------ */

/**
 * Resolve skill names to their content, concatenated as plain reference text.
 * Returns undefined if no skills or all failed to resolve.
 */
async function resolveSkillContent(
  skillNames?: string[],
): Promise<string | undefined> {
  if (!skillNames?.length) return undefined;

  const sections: string[] = [];
  for (const name of skillNames) {
    const skill = await getSkill(name);
    if (!skill) {
      console.warn(`[executor] Skill "${name}" not found, skipping`);
      continue;
    }
    const content = await appendSchemaDirectiveIfNeeded(
      skill.content,
      skill.metadata,
    );
    sections.push(content);
  }

  return sections.length > 0 ? sections.join("\n\n---\n\n") : undefined;
}

/* ------------------------------------------------------------------ */
/*  MCP loading (same pattern as agent.ts)                             */
/* ------------------------------------------------------------------ */

async function ensureExecutorMcps(names: string[]): Promise<void> {
  for (const name of names) {
    if (registry.getProvider(name)) continue;
    try {
      if (isCatalogEntry(name)) {
        loadFromCatalog(name);
      } else {
        const code = await mcpService.getMcpCode(name);
        if (!code) {
          console.warn(`[executor] MCP "${name}" not found, skipping`);
          continue;
        }
        const provider = await sandboxManager.load(name, code);
        registry.replace(provider);
      }
    } catch (err) {
      console.warn(`[executor] Failed to load MCP "${name}":`, err);
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Core executor loop                                                 */
/* ------------------------------------------------------------------ */

/**
 * Run an executor: a lightweight agent loop that follows instructions
 * and calls tools until done.
 *
 * Key differences from the main agent:
 * - No skill understanding or injection
 * - No eviction / compression (short-lived context)
 * - No persistent session (pure in-memory messages)
 * - Fixed tool scope (cannot self-expand)
 * - Cheap model by default
 */
export async function runExecutor(
  task: ExecutorTask,
  toolContext?: ToolContext,
): Promise<ExecutorResult> {
  const t0 = Date.now();
  const model = task.model ?? EXECUTOR_DEFAULT_MODEL;
  const maxIterations = task.maxIterations ?? 20;
  let toolCallCount = 0;

  try {
    await initMcp();
    await ensureExecutorMcps(task.mcpScope);

    // Build tool list from scoped MCPs
    const scope = new Set(task.mcpScope);
    const mcpTools = await registry.listToolsForProviders(scope);
    const openaiTools = mcpTools.map(mcpToolToOpenAI);

    // Resolve skill content (transparent injection — no "skill" concept exposed)
    const skillContent = await resolveSkillContent(task.skills);

    // In-memory message history — no DB persistence
    const systemPrompt = buildExecutorSystemPrompt(task.context, skillContent);
    const messages: LlmMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: task.instruction },
    ];

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      const completion = await chatCompletion(messages, openaiTools, model);
      const choice = completion.choices[0];
      if (!choice) {
        return {
          status: "failed",
          output: "",
          error: "No completion choice returned",
          toolCallCount,
          model,
          durationMs: Date.now() - t0,
        };
      }

      const { message: assistantMsg } = choice;

      // Append assistant message to context
      const assistantLlm: Record<string, unknown> = {
        role: "assistant",
        content: assistantMsg.content ?? null,
      };
      if (assistantMsg.tool_calls?.length) {
        assistantLlm.tool_calls = assistantMsg.tool_calls;
      }
      messages.push(assistantLlm as unknown as LlmMessage);

      // No tool calls → task complete
      if (!assistantMsg.tool_calls?.length) {
        return {
          status: "completed",
          output: assistantMsg.content ?? "",
          toolCallCount,
          model,
          durationMs: Date.now() - t0,
        };
      }

      // Execute tool calls
      const fnCalls = assistantMsg.tool_calls.filter(
        (tc): tc is Extract<typeof tc, { type: "function" }> =>
          tc.type === "function",
      );

      for (const tc of fnCalls) {
        toolCallCount++;
        let args: Record<string, unknown> = {};
        try {
          const parsed: unknown = JSON.parse(tc.function.arguments);
          if (typeof parsed === "object" && parsed !== null) {
            args = parsed as Record<string, unknown>;
          }
        } catch {
          /* invalid JSON, pass empty */
        }

        try {
          const result = await registry.callTool(
            tc.function.name,
            args,
            toolContext,
          );
          const content =
            result.content
              ?.map((c: Record<string, unknown>) =>
                "text" in c ? String(c.text) : JSON.stringify(c),
              )
              .join("\n") ?? "";

          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            content,
          } as unknown as LlmMessage);
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: `Error: ${errMsg}`,
          } as unknown as LlmMessage);
        }
      }
    }

    // Max iterations reached — capture last assistant content for diagnostics
    let lastOutput = "";
    for (let j = messages.length - 1; j >= 0; j--) {
      const m = messages[j]!;
      if ((m as unknown as Record<string, unknown>).role === "assistant") {
        const content = (m as unknown as Record<string, unknown>).content;
        if (typeof content === "string" && content) {
          lastOutput = content;
          break;
        }
      }
    }

    return {
      status: "max_iterations",
      output: lastOutput,
      error: `Reached max iterations (${maxIterations})`,
      toolCallCount,
      model,
      durationMs: Date.now() - t0,
    };
  } catch (err: unknown) {
    return {
      status: "failed",
      output: "",
      error: err instanceof Error ? err.message : String(err),
      toolCallCount,
      model,
      durationMs: Date.now() - t0,
    };
  }
}
