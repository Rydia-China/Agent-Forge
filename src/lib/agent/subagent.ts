import Ajv from "ajv";
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
import { resolveModelByType, type ModelUsageType } from "./models";
import type { ToolContext } from "@/lib/mcp/types";

/* ================================================================== */
/*  Usage-type inference                                                */
/* ================================================================== */

/** Infer the model usage type from a SubAgentConfig when not explicitly set. */
function inferUsageType(config: SubAgentConfig): ModelUsageType {
  if (config.mcpScope && config.mcpScope.length > 0) return "task-execution";
  return "prompt-execution";
}

/* ================================================================== */
/*  Types                                                              */
/* ================================================================== */

export interface SubAgentConfig {
  /** Concrete instruction / prompt. */
  instruction: string;
  /**
   * MCP provider names whose tools are available.
   * Empty or omitted → single-shot mode (one LLM call, no tools).
   * Non-empty → tool-loop mode (multi-iteration agent loop).
   */
  mcpScope?: string[];
  /**
   * LLM model override. When omitted the model is auto-selected by usageType.
   * Only specify when the user explicitly requests a model or a skill mandates one.
   */
  model?: string;
  /**
   * Categorises this call for model routing.
   * Auto-inferred when omitted: mcpScope → "task-execution", else "prompt-execution".
   */
  usageType?: ModelUsageType;
  /** Max tool-use iterations (tool-loop mode). Default 20. */
  maxIterations?: number;
  /** Additional context injected into the system prompt. */
  context?: string;
  /** Skill names whose content is injected as reference material. */
  skills?: string[];
  /** JSON Schema to validate output against (single-shot mode). */
  outputSchema?: Record<string, unknown>;
  /** Max validation+retry attempts (including first). Default 2. */
  maxRetries?: number;
  /** Image URLs for multimodal prompts (single-shot mode). */
  imageUrls?: string[];
  /** When set, successful result is persisted as a key JSON resource. */
  keyJsonTitle?: string;
  /** Parent agent ID — set automatically when spawned by another SubAgent. */
  parentAgentId?: string;
}

export interface ToolCallTrace {
  name: string;
  args: Record<string, unknown>;
  result: string;
  error?: string;
  durationMs: number;
  iteration: number;
}

export interface SubAgentTrace {
  /** Agent ID. */
  agentId: string;
  /** Parent agent ID (null if spawned by main controller). */
  parentAgentId: string | null;
  /** Nesting depth (0 = direct child of main controller). */
  depth: number;
  /** Complete internal message history (role + content). */
  messages: Array<{
    role: string;
    content: string | null;
    tool_calls?: unknown[];
    tool_call_id?: string;
  }>;
  /** Per-tool-call detailed records. */
  toolCalls: ToolCallTrace[];
  /** Actual system prompt used. */
  systemPrompt: string;
  /** Injected skill content (if any). */
  skillContent?: string;
  /** Model actually used. */
  model: string;
  /** Number of LLM call iterations. */
  iterations: number;
  /** Wall-clock duration in ms. */
  durationMs: number;
  /** Child subagent traces (populated by get_trace with tree=true). */
  children?: SubAgentTrace[];
}

export interface SubAgentResult {
  status: "completed" | "failed" | "max_iterations";
  /** Final text output. */
  output: string;
  error?: string;
  /** Total tool calls made. */
  toolCallCount: number;
  /** Model used. */
  model: string;
  /** Duration in ms. */
  durationMs: number;
  /** Full white-box trace. */
  trace: SubAgentTrace;
  /** Whether output was validated against a schema. */
  validated?: boolean;
  /** Number of validation attempts. */
  attempts?: number;
  /** Carried from config — signals key JSON resource. */
  keyJsonTitle?: string;
}

export interface SubAgentProgressCallbacks {
  onToolStart?: (name: string, iteration: number) => void;
  onToolEnd?: (name: string, durationMs: number, error?: string) => void;
}

/* ================================================================== */
/*  JSON Schema validation (ajv)                                       */
/* ================================================================== */

const ajv = new Ajv({ allErrors: true, verbose: true });

function stripMarkdownFences(raw: string): string {
  const trimmed = raw.trim();
  const fenceRe = /^```(?:json|JSON)?\s*\n([\s\S]*?)\n\s*```$/;
  const match = fenceRe.exec(trimmed);
  return match ? match[1]!.trim() : trimmed;
}

interface ValidationOk {
  ok: true;
  data: unknown;
}
interface ValidationFail {
  ok: false;
  error: string;
}
type ValidationResult = ValidationOk | ValidationFail;

function validateOutput(
  raw: string,
  schema: Record<string, unknown>,
): ValidationResult {
  const cleaned = stripMarkdownFences(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    return {
      ok: false,
      error: `JSON parse failed: ${
        e instanceof Error ? e.message : String(e)
      }\nRaw output (first 500 chars): ${cleaned.slice(0, 500)}`,
    };
  }

  const validate = ajv.compile(schema);
  if (validate(parsed)) {
    return { ok: true, data: parsed };
  }

  const errors = (validate.errors ?? []).map((err) => {
    const path = err.instancePath || "/";
    return `  ${path}: ${err.message}${err.params ? " " + JSON.stringify(err.params) : ""}`;
  });
  return {
    ok: false,
    error: `Schema validation failed:\n${errors.join("\n")}`,
  };
}

/* ================================================================== */
/*  System prompt for tool-loop mode                                   */
/* ================================================================== */

const TOOL_LOOP_RULES = `You are a SubAgent. Your job is to complete the given task by calling the available tools.

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

function buildToolLoopSystemPrompt(
  context?: string,
  skillContent?: string,
): string {
  const parts: string[] = [TOOL_LOOP_RULES];
  if (skillContent) parts.push(`## Reference Material\n${skillContent}`);
  if (context) parts.push(`## Additional Context\n${context}`);
  return parts.join("\n\n");
}

/* ================================================================== */
/*  Skill content resolution                                           */
/* ================================================================== */

async function resolveSkillContent(
  skillNames?: string[],
): Promise<string | undefined> {
  if (!skillNames?.length) return undefined;
  const sections: string[] = [];
  for (const name of skillNames) {
    const skill = await getSkill(name);
    if (!skill) {
      console.warn(`[subagent] Skill "${name}" not found, skipping`);
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

/* ================================================================== */
/*  MCP loading                                                        */
/* ================================================================== */

async function ensureMcps(names: string[]): Promise<void> {
  for (const name of names) {
    if (registry.getProvider(name)) continue;
    try {
      if (isCatalogEntry(name)) {
        loadFromCatalog(name);
      } else {
        const code = await mcpService.getMcpCode(name);
        if (!code) {
          console.warn(`[subagent] MCP "${name}" not found, skipping`);
          continue;
        }
        const provider = await sandboxManager.load(name, code);
        registry.replace(provider);
      }
    } catch (err) {
      console.warn(`[subagent] Failed to load MCP "${name}":`, err);
    }
  }
}

/* ================================================================== */
/*  Multimodal content builder                                         */
/* ================================================================== */

type MessageContent =
  | string
  | Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    >;

function buildContent(text: string, imageUrls?: string[]): MessageContent {
  if (imageUrls && imageUrls.length > 0) {
    return [
      { type: "text", text },
      ...imageUrls.map((url) => ({
        type: "image_url" as const,
        image_url: { url },
      })),
    ];
  }
  return text;
}

/* ================================================================== */
/*  In-memory SubAgent registry (for multi-turn)                       */
/* ================================================================== */

const activeAgents = new Map<string, SubAgent>();

/** Max nesting depth for subagent trees. */
export const MAX_SUBAGENT_DEPTH = 3;

/** Retrieve an active SubAgent instance by ID. */
export function getActiveSubAgent(agentId: string): SubAgent | undefined {
  return activeAgents.get(agentId);
}

/** Remove a SubAgent from the active registry (cleanup). */
export function removeActiveSubAgent(agentId: string): void {
  activeAgents.delete(agentId);
}

/** List all children of a given agent (by parentAgentId). */
export function getChildAgents(parentId: string): SubAgent[] {
  const children: SubAgent[] = [];
  for (const agent of activeAgents.values()) {
    if (agent.parentAgentId === parentId) children.push(agent);
  }
  return children;
}

/**
 * Recursively build a trace tree rooted at the given agent.
 * Attaches child traces to the `children` field.
 */
export function getTraceTree(agentId: string): SubAgentTrace | undefined {
  const agent = getActiveSubAgent(agentId);
  if (!agent) return undefined;
  const trace = agent.getTrace();
  const children = getChildAgents(agentId);
  if (children.length > 0) {
    trace.children = children
      .map((c) => getTraceTree(c.id))
      .filter((t): t is SubAgentTrace => !!t);
  }
  return trace;
}

/* ================================================================== */
/*  SubAgent class                                                     */
/* ================================================================== */

let agentCounter = 0;

export class SubAgent {
  readonly id: string;
  /** Exposed for tree traversal. */
  readonly parentAgentId: string | null;
  readonly depth: number;
  private readonly config: SubAgentConfig;
  private readonly model: string;
  private readonly isToolLoop: boolean;

  /* Internal state */
  private messages: LlmMessage[] = [];
  private toolCallTraces: ToolCallTrace[] = [];
  private systemPrompt = "";
  private skillContent?: string;
  private totalToolCalls = 0;
  private totalDurationMs = 0;
  private iterations = 0;
  private initialized = false;

  constructor(config: SubAgentConfig, depth = 0) {
    this.id = `sa_${++agentCounter}_${Date.now()}`;
    this.config = config;
    const usageType = config.usageType ?? inferUsageType(config);
    this.model = resolveModelByType(usageType, config.model);
    this.isToolLoop = !!(config.mcpScope && config.mcpScope.length > 0);
    this.parentAgentId = config.parentAgentId ?? null;
    this.depth = depth;
    // Register in active agents for multi-turn
    activeAgents.set(this.id, this);
  }

  /* ---------------------------------------------------------------- */
  /*  Public: run (first turn)                                         */
  /* ---------------------------------------------------------------- */

  async run(
    toolContext?: ToolContext,
    progress?: SubAgentProgressCallbacks,
  ): Promise<SubAgentResult> {
    const t0 = Date.now();
    try {
      await this.init();

      if (this.isToolLoop) {
        return await this.runToolLoop(t0, toolContext, progress);
      }
      return await this.runSingleShot(t0);
    } catch (err: unknown) {
      return this.failResult(t0, err);
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Public: continue (multi-turn)                                    */
  /* ---------------------------------------------------------------- */

  async continue(
    feedback: string,
    toolContext?: ToolContext,
    progress?: SubAgentProgressCallbacks,
  ): Promise<SubAgentResult> {
    const t0 = Date.now();
    try {
      if (!this.initialized) {
        throw new Error("SubAgent has not been run yet — call run() first");
      }

      // Append feedback as a user message
      this.messages.push({ role: "user", content: feedback } as LlmMessage);

      if (this.isToolLoop) {
        return await this.runToolLoop(t0, toolContext, progress);
      }
      return await this.runSingleShot(t0);
    } catch (err: unknown) {
      return this.failResult(t0, err);
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Public: get trace                                                */
  /* ---------------------------------------------------------------- */

  getTrace(): SubAgentTrace {
    return {
      agentId: this.id,
      parentAgentId: this.parentAgentId,
      depth: this.depth,
      messages: this.messages.map((m) => {
        const r = m as unknown as Record<string, unknown>;
        return {
          role: String(r.role ?? ""),
          content: typeof r.content === "string" ? r.content : null,
          ...(Array.isArray(r.tool_calls) ? { tool_calls: r.tool_calls } : {}),
          ...(typeof r.tool_call_id === "string"
            ? { tool_call_id: r.tool_call_id }
            : {}),
        };
      }),
      toolCalls: [...this.toolCallTraces],
      systemPrompt: this.systemPrompt,
      skillContent: this.skillContent,
      model: this.model,
      iterations: this.iterations,
      durationMs: this.totalDurationMs,
    };
  }

  /* ================================================================ */
  /*  Private: initialization                                          */
  /* ================================================================ */

  private async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    await initMcp();

    // Resolve skills
    this.skillContent = await resolveSkillContent(this.config.skills);

    if (this.isToolLoop) {
      // Tool-loop mode: load MCPs, build system prompt
      await ensureMcps(this.config.mcpScope!);
      this.systemPrompt = buildToolLoopSystemPrompt(
        this.config.context,
        this.skillContent,
      );
      this.messages = [
        { role: "system", content: this.systemPrompt } as LlmMessage,
        { role: "user", content: this.config.instruction } as LlmMessage,
      ];
    } else {
      // Single-shot mode: just the user message (with optional images)
      const content = buildContent(
        this.config.instruction,
        this.config.imageUrls,
      );
      this.messages = [
        { role: "user", content } as unknown as LlmMessage,
      ];
    }
  }

  /* ================================================================ */
  /*  Private: single-shot execution                                   */
  /* ================================================================ */

  private async runSingleShot(t0: number): Promise<SubAgentResult> {
    const completion = await chatCompletion(
      this.messages,
      undefined,
      this.model,
    );
    const raw = completion.choices[0]?.message.content ?? "";
    this.iterations++;

    // Append assistant message to internal history
    this.messages.push({
      role: "assistant",
      content: raw,
    } as LlmMessage);

    // No schema → return raw text
    if (!this.config.outputSchema) {
      this.totalDurationMs += Date.now() - t0;
      return {
        status: "completed",
        output: raw,
        toolCallCount: 0,
        model: this.model,
        durationMs: Date.now() - t0,
        trace: this.getTrace(),
        keyJsonTitle: this.config.keyJsonTitle,
      };
    }

    // Schema validation + retry
    const maxRetries = this.config.maxRetries ?? 2;
    let validation = validateOutput(raw, this.config.outputSchema);
    if (validation.ok) {
      this.totalDurationMs += Date.now() - t0;
      return {
        status: "completed",
        output: JSON.stringify(validation.data),
        toolCallCount: 0,
        model: this.model,
        durationMs: Date.now() - t0,
        trace: this.getTrace(),
        validated: true,
        attempts: 1,
        keyJsonTitle: this.config.keyJsonTitle,
      };
    }

    // Retry loop
    for (let attempt = 2; attempt <= maxRetries; attempt++) {
      console.warn(
        `[subagent] Validation failed (attempt ${attempt - 1}/${maxRetries}), retrying`,
      );

      const retryContent = buildContent(
        this.config.instruction +
          "\n\n" +
          "[VALIDATION ERROR — your previous output failed schema validation]\n" +
          validation.error +
          "\n\n" +
          "Please fix the issues above and output ONLY valid JSON (no markdown fences, no extra text).",
        this.config.imageUrls,
      );

      this.messages.push({
        role: "user",
        content: retryContent,
      } as unknown as LlmMessage);

      const retryCompletion = await chatCompletion(
        this.messages,
        undefined,
        this.model,
      );
      const retryRaw = retryCompletion.choices[0]?.message.content ?? "";
      this.iterations++;

      this.messages.push({
        role: "assistant",
        content: retryRaw,
      } as LlmMessage);

      validation = validateOutput(retryRaw, this.config.outputSchema);
      if (validation.ok) {
        this.totalDurationMs += Date.now() - t0;
        return {
          status: "completed",
          output: JSON.stringify(validation.data),
          toolCallCount: 0,
          model: this.model,
          durationMs: Date.now() - t0,
          trace: this.getTrace(),
          validated: true,
          attempts: attempt,
          keyJsonTitle: this.config.keyJsonTitle,
        };
      }
    }

    // All retries exhausted
    this.totalDurationMs += Date.now() - t0;
    return {
      status: "failed",
      output: "",
      error: `Schema validation failed after ${maxRetries} attempts.\nLast error: ${validation.error}`,
      toolCallCount: 0,
      model: this.model,
      durationMs: Date.now() - t0,
      trace: this.getTrace(),
      validated: false,
      attempts: maxRetries,
    };
  }

  /* ================================================================ */
  /*  Private: tool-loop execution                                     */
  /* ================================================================ */

  private async runToolLoop(
    t0: number,
    toolContext?: ToolContext,
    progress?: SubAgentProgressCallbacks,
  ): Promise<SubAgentResult> {
    const maxIterations = this.config.maxIterations ?? 20;

    // Build tool list from scoped MCPs
    const scope = new Set(this.config.mcpScope!);
    const mcpTools = await registry.listToolsForProviders(scope);
    const openaiTools = mcpTools.map(mcpToolToOpenAI);

    for (
      let iteration = this.iterations;
      iteration < this.iterations + maxIterations;
      iteration++
    ) {
      const completion = await chatCompletion(
        this.messages,
        openaiTools,
        this.model,
      );
      const choice = completion.choices[0];
      if (!choice) {
        this.totalDurationMs += Date.now() - t0;
        return {
          status: "failed",
          output: "",
          error: "No completion choice returned",
          toolCallCount: this.totalToolCalls,
          model: this.model,
          durationMs: Date.now() - t0,
          trace: this.getTrace(),
        };
      }

      const { message: assistantMsg } = choice;

      // Append assistant message
      const assistantLlm: Record<string, unknown> = {
        role: "assistant",
        content: assistantMsg.content ?? null,
      };
      if (assistantMsg.tool_calls?.length) {
        assistantLlm.tool_calls = assistantMsg.tool_calls;
      }
      this.messages.push(assistantLlm as unknown as LlmMessage);

      // No tool calls → task complete
      if (!assistantMsg.tool_calls?.length) {
        this.iterations = iteration + 1;
        this.totalDurationMs += Date.now() - t0;
        return {
          status: "completed",
          output: assistantMsg.content ?? "",
          toolCallCount: this.totalToolCalls,
          model: this.model,
          durationMs: Date.now() - t0,
          trace: this.getTrace(),
        };
      }

      // Execute tool calls
      const fnCalls = assistantMsg.tool_calls.filter(
        (tc): tc is Extract<typeof tc, { type: "function" }> =>
          tc.type === "function",
      );

      for (const tc of fnCalls) {
        this.totalToolCalls++;
        progress?.onToolStart?.(tc.function.name, iteration);

        let args: Record<string, unknown> = {};
        try {
          const parsed: unknown = JSON.parse(tc.function.arguments);
          if (typeof parsed === "object" && parsed !== null) {
            args = parsed as Record<string, unknown>;
          }
        } catch {
          /* invalid JSON, pass empty */
        }

        // Detect API proxy error injected as tool call arguments
        if ("ERROR" in args || "error" in args) {
          const errPayload = (args.ERROR ?? args.error) as Record<string, unknown> | string;
          const errMsg = typeof errPayload === "string"
            ? errPayload
            : typeof errPayload === "object" && errPayload !== null
              ? String((errPayload as Record<string, unknown>).message ?? JSON.stringify(errPayload))
              : String(errPayload);
          console.warn(`[subagent] API proxy error in tool args for ${tc.function.name}: ${errMsg}`);
          const errorResult = `API proxy error (not a tool failure): ${errMsg}. Please retry the same tool call.`;
          this.messages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: errorResult,
          } as unknown as LlmMessage);
          progress?.onToolEnd?.(tc.function.name, 0, `proxy error: ${errMsg}`);
          this.toolCallTraces.push({
            name: tc.function.name,
            args,
            result: errorResult,
            error: `proxy error: ${errMsg}`,
            durationMs: 0,
            iteration,
          });
          continue;
        }

        const t1 = Date.now();
        let toolError: string | undefined;
        let resultText = "";
        try {
        const result = await registry.callTool(
            tc.function.name,
            args,
            // Inject parent context so child subagents know their lineage
            {
              ...toolContext,
              parentAgentId: this.id,
              agentDepth: this.depth + 1,
            },
          );
          resultText =
            result.content
              ?.map((c: Record<string, unknown>) =>
                "text" in c ? String(c.text) : JSON.stringify(c),
              )
              .join("\n") ?? "";

          this.messages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: resultText,
          } as unknown as LlmMessage);
        } catch (err: unknown) {
          toolError = err instanceof Error ? err.message : String(err);
          resultText = `Error: ${toolError}`;
          this.messages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: resultText,
          } as unknown as LlmMessage);
        } finally {
          const callDuration = Date.now() - t1;
          progress?.onToolEnd?.(tc.function.name, callDuration, toolError);

          // Record trace
          this.toolCallTraces.push({
            name: tc.function.name,
            args,
            result: resultText,
            error: toolError,
            durationMs: callDuration,
            iteration,
          });
        }
      }
    }

    // Max iterations reached
    this.iterations += maxIterations;
    let lastOutput = "";
    for (let j = this.messages.length - 1; j >= 0; j--) {
      const m = this.messages[j] as unknown as Record<string, unknown>;
      if (m.role === "assistant" && typeof m.content === "string" && m.content) {
        lastOutput = m.content;
        break;
      }
    }

    this.totalDurationMs += Date.now() - t0;
    return {
      status: "max_iterations",
      output: lastOutput,
      error: `Reached max iterations (${this.config.maxIterations ?? 20})`,
      toolCallCount: this.totalToolCalls,
      model: this.model,
      durationMs: Date.now() - t0,
      trace: this.getTrace(),
    };
  }

  /* ================================================================ */
  /*  Private: error helper                                            */
  /* ================================================================ */

  private failResult(t0: number, err: unknown): SubAgentResult {
    this.totalDurationMs += Date.now() - t0;
    return {
      status: "failed",
      output: "",
      error: err instanceof Error ? err.message : String(err),
      toolCallCount: this.totalToolCalls,
      model: this.model,
      durationMs: Date.now() - t0,
      trace: this.getTrace(),
    };
  }
}

/* ================================================================== */
/*  Convenience: run a SubAgent as a one-off (backward compat)         */
/* ================================================================== */

/**
 * Run a SubAgent task and return the result.
 * The SubAgent instance stays in the active registry for potential `continue()` calls.
 */
export async function runSubAgent(
  config: SubAgentConfig,
  toolContext?: ToolContext,
  progress?: SubAgentProgressCallbacks,
): Promise<SubAgentResult & { agentId: string }> {
  const depth = toolContext?.agentDepth ?? 0;
  const parentId = toolContext?.parentAgentId;
  const configWithParent: SubAgentConfig = {
    ...config,
    ...(parentId ? { parentAgentId: parentId } : {}),
  };
  const agent = new SubAgent(configWithParent, depth);
  const result = await agent.run(toolContext, progress);
  return { ...result, agentId: agent.id };
}
