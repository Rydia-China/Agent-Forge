import Ajv from "ajv";
import type { ChatCompletionContentPart } from "openai/resources/chat/completions";
import { registry } from "@/lib/mcp/registry";
import {
  chatCompletion,
  mcpToolToOpenAI,
  type ChatCompletionOptions,
  type LlmMessage,
} from "./llm-client";
import { resolveModel } from "./models";
import type { CallToolResult, ToolContext } from "@/lib/mcp/types";

/* ================================================================== */
/*  Types                                                              */
/* ================================================================== */

export type ModelUsageType =
  | "task-execution"
  | "prompt-execution"
  | "controller"
  | "utility";

export interface SubAgentConfig {
  /** Concrete instruction / prompt. */
  instruction: string;
  /**
   * MCP provider names whose tools are available.
   * Empty or omitted → single-shot mode (one LLM call, no tools).
   * Non-empty → tool-loop mode (multi-iteration agent loop).
   */
  mcpScope?: string[];
  /** Current model override; invalid or omitted values fall back to DEFAULT_MODEL. */
  model?: string;
  /** Retained for compatibility with historical callers; current routing uses model directly. */
  usageType?: ModelUsageType;
  /** Max tool-use iterations (tool-loop mode). Default 20. */
  maxIterations?: number;
  /** Delay in seconds after each tool-call round (tool-loop mode). */
  delayTime?: number;
  /** Additional context injected into the system prompt. */
  context?: string;
  /** Skill names whose content is injected as reference material. */
  skills?: string[];
  /** JSON Schema to validate output against. */
  outputSchema?: Record<string, unknown>;
  /** Max validation+retry attempts (including first). Default 2. */
  maxRetries?: number;
  /** Image URLs for multimodal prompts (single-shot mode). */
  imageUrls?: string[];
  /** When set, successful result is carried for upstream key JSON persistence. */
  keyJsonTitle?: string;
  /** Parent agent ID — set automatically when spawned by another SubAgent. */
  parentAgentId?: string;
  /** Persisted SubAgent row ID for durable trace parentage. */
  persistentAgentId?: string;
}

export interface ToolCallTrace {
  name: string;
  args: Record<string, unknown>;
  result: string;
  error?: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  delayAfterMs?: number;
  iteration: number;
}

export interface SubAgentTraceMessage {
  role: string;
  content: string | null;
  tool_calls?: unknown[];
  tool_call_id?: string;
  reasoning_content?: string;
}

export interface SubAgentTrace {
  /** Agent ID. */
  agentId: string;
  /** Parent agent ID (null if spawned by main controller). */
  parentAgentId: string | null;
  /** Nesting depth (0 = direct child of main controller). */
  depth: number;
  /** Complete internal message history (role + content). */
  messages: SubAgentTraceMessage[];
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
  status: "completed" | "failed" | "max_iterations" | "cancelled";
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

declare global {
  var __agentForgeMcpSubAgents: Map<string, SubAgent> | undefined;
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

function validationParseErrorMessage(error: unknown): string {
  return `JSON parse failed: ${error instanceof Error ? error.message : String(error)}`;
}

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
      error: validationParseErrorMessage(e),
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

function buildValidationRetryPrompt(error: string): string {
  return [
    "[VALIDATION ERROR — your previous output failed schema validation]",
    error,
    "",
    "Please fix the issues above and output ONLY valid JSON (no markdown fences, no extra text).",
  ].join("\n");
}

function failedValidationAssistantMessage(error: string): LlmMessage {
  return {
    role: "assistant",
    content: `[discarded invalid non-JSON/schema-invalid output: ${error}]`,
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

function buildSingleShotSystemPrompt(
  context?: string,
  skillContent?: string,
): string | undefined {
  const parts: string[] = [];
  if (skillContent) parts.push(`## Reference Material\n${skillContent}`);
  if (context) parts.push(`## Additional Context\n${context}`);
  return parts.length > 0 ? parts.join("\n\n") : undefined;
}

/* ================================================================== */
/*  General helpers                                                    */
/* ================================================================== */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getReasoningContent(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const raw = value.reasoning_content;
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}

function messageWithReasoning(
  message: Record<string, unknown>,
  source: unknown,
): LlmMessage {
  const reasoningContent = getReasoningContent(source);
  if (reasoningContent) {
    message.reasoning_content = reasoningContent;
  }
  return message as unknown as LlmMessage;
}

function parseToolArgs(raw: string): Record<string, unknown> {
  const parseCandidate = (candidate: string): Record<string, unknown> | null => {
    try {
      const parsed: unknown = JSON.parse(candidate);
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  };

  const parsedRaw = parseCandidate(raw);
  if (parsedRaw) return parsedRaw;

  const candidates: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      escaped = inString;
      continue;
    }

    if (ch === "\"") {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
      continue;
    }

    if (ch === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        candidates.push(raw.slice(start, i + 1));
        start = -1;
      }
    }
  }

  for (let i = candidates.length - 1; i >= 0; i--) {
    const parsed = parseCandidate(candidates[i]!);
    if (parsed && Object.keys(parsed).length > 0) return parsed;
  }

  for (let i = candidates.length - 1; i >= 0; i--) {
    const parsed = parseCandidate(candidates[i]!);
    if (parsed) return parsed;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error("SubAgent cancelled");
  }
}

function buildChatOptions(
  jsonResponse: boolean,
  signal?: AbortSignal,
): ChatCompletionOptions | undefined {
  const options: ChatCompletionOptions = {};
  if (jsonResponse) options.responseFormat = { type: "json_object" };
  if (signal) options.signal = signal;
  return options.responseFormat || options.signal ? options : undefined;
}

function toolResultToText(result: CallToolResult): string {
  return result.content
    .map((item) => (item.type === "text" ? item.text : JSON.stringify(item)))
    .join("\n");
}

function traceContentFromMessage(message: LlmMessage): string | null {
  if (!("content" in message)) return null;
  const content = message.content;
  if (typeof content === "string") return content;
  if (content === null || content === undefined) return null;
  return JSON.stringify(content);
}

function traceMessageFromLlm(message: LlmMessage): SubAgentTraceMessage {
  const out: SubAgentTraceMessage = {
    role: message.role,
    content: traceContentFromMessage(message),
  };
  if ("tool_calls" in message && Array.isArray(message.tool_calls)) {
    out.tool_calls = message.tool_calls;
  }
  if ("tool_call_id" in message && typeof message.tool_call_id === "string") {
    out.tool_call_id = message.tool_call_id;
  }
  const reasoningContent = getReasoningContent(message);
  if (reasoningContent) {
    out.reasoning_content = reasoningContent;
  }
  return out;
}

/* ================================================================== */
/*  Skill content resolution                                           */
/* ================================================================== */

async function resolveSkillContent(
  skillNames?: string[],
): Promise<string | undefined> {
  if (!skillNames?.length) return undefined;
  const { getSkill } = await import("@/lib/services/skill-service");
  const sections: string[] = [];
  for (const name of skillNames) {
    const skill = await getSkill(name);
    if (!skill) {
      console.warn(`[subagent] Skill "${name}" not found, skipping`);
      continue;
    }
    sections.push(skill.content);
  }
  return sections.length > 0 ? sections.join("\n\n---\n\n") : undefined;
}

/* ================================================================== */
/*  MCP scope resolution                                               */
/* ================================================================== */

async function resolveAvailableMcpScope(names: string[]): Promise<string[]> {
  const available: string[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) continue;
    seen.add(name);
    if (registry.getProvider(name)) {
      available.push(name);
    } else {
      console.warn(`[subagent] MCP provider "${name}" is not registered, skipping`);
    }
  }
  return available;
}

/* ================================================================== */
/*  Multimodal content builder                                         */
/* ================================================================== */

type MessageContent = string | ChatCompletionContentPart[];

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

const activeAgents = globalThis.__agentForgeMcpSubAgents ?? new Map<string, SubAgent>();
globalThis.__agentForgeMcpSubAgents = activeAgents;

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
      .filter((t): t is SubAgentTrace => t !== undefined);
  }
  return trace;
}

/* ================================================================== */
/*  SubAgent class                                                     */
/* ================================================================== */

export class SubAgent {
  readonly id: string;
  /** Exposed for tree traversal. */
  readonly parentAgentId: string | null;
  readonly depth: number;
  private readonly config: SubAgentConfig;
  private readonly model: string;
  private readonly isToolLoop: boolean;
  private readonly persistentAgentId?: string;
  private availableMcpScope: string[] = [];

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
    this.id = `sa_${crypto.randomUUID()}`;
    this.config = config;
    this.model = resolveModel(config.model);
    this.isToolLoop = !!(config.mcpScope && config.mcpScope.length > 0);
    this.parentAgentId = config.parentAgentId ?? null;
    this.persistentAgentId = config.persistentAgentId;
    this.depth = depth;
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
      throwIfAborted(toolContext?.signal);
      await this.init();
      throwIfAborted(toolContext?.signal);

      if (this.isToolLoop) {
        return await this.runToolLoop(t0, toolContext, progress);
      }
      return await this.runSingleShot(t0, toolContext?.signal);
    } catch (err: unknown) {
      if (toolContext?.signal?.aborted) {
        return this.cancelledResult(t0);
      }
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
      throwIfAborted(toolContext?.signal);
      if (!this.initialized) {
        throw new Error("SubAgent has not been run yet — call run() first");
      }

      this.messages.push({ role: "user", content: feedback });
      throwIfAborted(toolContext?.signal);

      if (this.isToolLoop) {
        return await this.runToolLoop(t0, toolContext, progress);
      }
      return await this.runSingleShot(t0, toolContext?.signal);
    } catch (err: unknown) {
      if (toolContext?.signal?.aborted) {
        return this.cancelledResult(t0);
      }
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
      messages: this.messages.map(traceMessageFromLlm),
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

    this.skillContent = await resolveSkillContent(this.config.skills);

    if (this.isToolLoop) {
      this.availableMcpScope = await resolveAvailableMcpScope(this.config.mcpScope ?? []);
      this.systemPrompt = buildToolLoopSystemPrompt(
        this.config.context,
        this.skillContent,
      );
      this.messages = [
        { role: "system", content: this.systemPrompt },
        { role: "user", content: this.config.instruction },
      ];
    } else {
      this.systemPrompt = buildSingleShotSystemPrompt(
        this.config.context,
        this.skillContent,
      ) ?? "";
      const content = buildContent(
        this.config.instruction,
        this.config.imageUrls,
      );
      this.messages = this.systemPrompt
        ? [
            { role: "system", content: this.systemPrompt },
            { role: "user", content },
          ]
        : [{ role: "user", content }];
    }
  }

  /* ================================================================ */
  /*  Private: single-shot execution                                   */
  /* ================================================================ */

  private async runSingleShot(t0: number, signal?: AbortSignal): Promise<SubAgentResult> {
    const maxRetries = this.config.outputSchema ? (this.config.maxRetries ?? 2) : 1;
    let validation: ValidationResult | undefined;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      throwIfAborted(signal);
      const completion = await chatCompletion(
        this.messages,
        undefined,
        this.model,
        buildChatOptions(!!this.config.outputSchema, signal),
      );
      throwIfAborted(signal);
      const assistantMsg = completion.choices[0]?.message;
      const raw = assistantMsg?.content ?? "";
      this.iterations++;

      this.messages.push(messageWithReasoning(
        { role: "assistant", content: raw },
        assistantMsg,
      ));

      if (!this.config.outputSchema) {
        return this.completedResult(t0, raw);
      }

      validation = validateOutput(raw, this.config.outputSchema);
      if (validation.ok) {
        return this.completedResult(t0, JSON.stringify(validation.data), {
          validated: true,
          attempts: attempt,
        });
      }

      this.messages[this.messages.length - 1] = failedValidationAssistantMessage(validation.error);

      if (attempt < maxRetries) {
        console.warn(
          `[subagent] Validation failed (attempt ${attempt}/${maxRetries}), retrying`,
        );
        this.messages.push({
          role: "user",
          content: buildValidationRetryPrompt(validation.error),
        });
      }
    }

    return this.failedValidationResult(t0, maxRetries, validation);
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
    const maxValidationAttempts = this.config.outputSchema ? (this.config.maxRetries ?? 2) : 1;
    let validationAttempts = 0;
    let lastValidation: ValidationResult | undefined;

    throwIfAborted(toolContext?.signal);
    const mcpTools = await registry.listToolsForProviders(this.availableMcpScope);
    const openaiTools = mcpTools.map(mcpToolToOpenAI);

    const startIteration = this.iterations;
    for (let localIteration = 0; localIteration < maxIterations; localIteration++) {
      throwIfAborted(toolContext?.signal);
      const iteration = startIteration + localIteration;
      const completion = await chatCompletion(
        this.messages,
        openaiTools,
        this.model,
        buildChatOptions(!!this.config.outputSchema, toolContext?.signal),
      );
      throwIfAborted(toolContext?.signal);
      const choice = completion.choices[0];
      if (!choice) {
        return this.failResult(t0, new Error("No completion choice returned"));
      }

      const assistantMsg = choice.message;
      const normalizedToolCalls = assistantMsg.tool_calls?.map((tc) => {
        if (tc.type !== "function") return tc;
        return {
          ...tc,
          function: {
            ...tc.function,
            arguments: JSON.stringify(parseToolArgs(tc.function.arguments)),
          },
        };
      });
      const assistantLlm = messageWithReasoning(
        {
          role: "assistant",
          content: assistantMsg.content ?? null,
          ...(normalizedToolCalls?.length ? { tool_calls: normalizedToolCalls } : {}),
        },
        assistantMsg,
      );
      this.messages.push(assistantLlm);
      this.iterations = iteration + 1;
      if (!normalizedToolCalls?.length) {
        const finalOutput = assistantMsg.content ?? "";
        if (!this.config.outputSchema) {
          return this.completedResult(t0, finalOutput);
        }

        validationAttempts++;
        lastValidation = validateOutput(finalOutput, this.config.outputSchema);
        if (lastValidation.ok) {
          return this.completedResult(t0, JSON.stringify(lastValidation.data), {
            validated: true,
            attempts: validationAttempts,
          });
        }

        this.messages[this.messages.length - 1] = failedValidationAssistantMessage(lastValidation.error);

        if (validationAttempts >= maxValidationAttempts) {
          return this.failedValidationResult(t0, maxValidationAttempts, lastValidation);
        }

        this.messages.push({
          role: "user",
          content: buildValidationRetryPrompt(lastValidation.error),
        });
        continue;
      }
      const functionToolCalls = normalizedToolCalls.filter(
        (tc): tc is Extract<typeof tc, { type: "function" }> => tc.type === "function",
      );

      const delayTime = this.config.delayTime ?? 0;
      const delayAfterMs = delayTime * 1000;

      for (let toolIndex = 0; toolIndex < functionToolCalls.length; toolIndex++) {
        throwIfAborted(toolContext?.signal);
        if (toolIndex > 0 && delayAfterMs > 0) {
          const previousTrace = this.toolCallTraces[this.toolCallTraces.length - 1];
          if (previousTrace) previousTrace.delayAfterMs = delayAfterMs;
          await sleep(delayAfterMs);
          throwIfAborted(toolContext?.signal);
        }

        const tc = functionToolCalls[toolIndex]!;
        this.totalToolCalls++;
        progress?.onToolStart?.(tc.function.name, iteration);

        const args = parseToolArgs(tc.function.arguments);
        const startedAt = new Date();
        const t1 = Date.now();
        let toolError: string | undefined;
        let resultText = "";
        try {
          throwIfAborted(toolContext?.signal);
          const result = await registry.callTool(
            tc.function.name,
            args,
            {
              ...toolContext,
              parentAgentId: this.id,
              persistentParentAgentId: this.persistentAgentId ?? toolContext?.persistentParentAgentId,
              agentDepth: this.depth + 1,
            },
          );
          throwIfAborted(toolContext?.signal);
          resultText = toolResultToText(result);
          if (result.isError) {
            toolError = resultText;
          }
        } catch (err: unknown) {
          if (toolContext?.signal?.aborted) {
            throw err;
          }
          toolError = err instanceof Error ? err.message : String(err);
          resultText = `Error: ${toolError}`;
        }

        this.messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: resultText,
        });

        const callDuration = Date.now() - t1;
        const endedAt = new Date();
        progress?.onToolEnd?.(tc.function.name, callDuration, toolError);
        this.toolCallTraces.push({
          name: tc.function.name,
          args,
          result: resultText,
          error: toolError,
          startedAt: startedAt.toISOString(),
          endedAt: endedAt.toISOString(),
          durationMs: callDuration,
          iteration,
        });
      }

      if (functionToolCalls.length > 0 && delayTime > 0 && localIteration < maxIterations - 1) {
        const lastTrace = this.toolCallTraces[this.toolCallTraces.length - 1];
        if (lastTrace) lastTrace.delayAfterMs = delayAfterMs;
        await sleep(delayAfterMs);
        throwIfAborted(toolContext?.signal);
      }
    }

    return this.maxIterationsResult(t0, maxIterations);
  }

  /* ================================================================ */
  /*  Private: result helpers                                          */
  /* ================================================================ */

  private completedResult(
    t0: number,
    output: string,
    extra?: Pick<SubAgentResult, "validated" | "attempts">,
  ): SubAgentResult {
    const elapsed = Date.now() - t0;
    this.totalDurationMs += elapsed;
    return {
      status: "completed",
      output,
      toolCallCount: this.totalToolCalls,
      model: this.model,
      durationMs: elapsed,
      trace: this.getTrace(),
      keyJsonTitle: this.config.keyJsonTitle,
      ...extra,
    };
  }

  private failedValidationResult(
    t0: number,
    attempts: number,
    validation?: ValidationResult,
  ): SubAgentResult {
    const message = validation && !validation.ok
      ? validation.error
      : "Unknown validation error";
    return this.failResult(
      t0,
      new Error(`Schema validation failed after ${attempts} attempts.\nLast error: ${message}`),
      { validated: false, attempts },
    );
  }

  private maxIterationsResult(t0: number, maxIterations: number): SubAgentResult {
    let lastOutput = "";
    for (let j = this.messages.length - 1; j >= 0; j--) {
      const content = traceContentFromMessage(this.messages[j]!);
      if (this.messages[j]!.role === "assistant" && content) {
        lastOutput = content;
        break;
      }
    }

    const elapsed = Date.now() - t0;
    this.totalDurationMs += elapsed;
    return {
      status: "max_iterations",
      output: lastOutput,
      error: `Reached max iterations (${maxIterations})`,
      toolCallCount: this.totalToolCalls,
      model: this.model,
      durationMs: elapsed,
      trace: this.getTrace(),
    };
  }

  private failResult(
    t0: number,
    err: unknown,
    extra?: Pick<SubAgentResult, "validated" | "attempts">,
  ): SubAgentResult {
    const elapsed = Date.now() - t0;
    this.totalDurationMs += elapsed;
    return {
      status: "failed",
      output: "",
      error: err instanceof Error ? err.message : String(err),
      toolCallCount: this.totalToolCalls,
      model: this.model,
      durationMs: elapsed,
      trace: this.getTrace(),
      ...extra,
    };
  }

  private cancelledResult(t0: number): SubAgentResult {
    const elapsed = Date.now() - t0;
    this.totalDurationMs += elapsed;
    return {
      status: "cancelled",
      output: "",
      error: "SubAgent cancelled",
      toolCallCount: this.totalToolCalls,
      model: this.model,
      durationMs: elapsed,
      trace: this.getTrace(),
      keyJsonTitle: this.config.keyJsonTitle,
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
