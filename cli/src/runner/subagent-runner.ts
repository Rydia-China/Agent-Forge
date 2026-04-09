import type { Trace, EvalCase, UnitInput } from "../types.js";
import { config } from "../config.js";

/**
 * Run a unit-mode eval case by calling subagent.callTool directly.
 * No Next.js, no Prisma — only needs LLM_API_KEY and LLM_BASE_URL.
 */
export async function runUnitCase(evalCase: EvalCase, runIndex: number): Promise<Trace> {
  const input = evalCase.input as UnitInput;
  if (!input) throw new Error(`Case ${evalCase.name}: missing input`);

  const t0 = Date.now();
  let prompt = input.prompt ?? "";

  // If langfuse source, compile the prompt
  if (input.langfuse) {
    const { langfuseMcp } = await import("@/lib/mcp/static/langfuse.js");
    const result = await langfuseMcp.callTool("compile_prompts", {
      items: [{
        name: input.langfuse.name,
        variables: input.langfuse.variables ?? {},
      }],
    });
    const text = result.content?.[0];
    if (!text || !("text" in text)) throw new Error("Langfuse compile returned no content");
    const parsed = JSON.parse(text.text as string) as Array<{ status: string; compiledPrompt?: string; error?: string }>;
    const first = parsed[0];
    if (!first || first.status !== "ok" || !first.compiledPrompt) {
      throw new Error(`Langfuse compile failed: ${first?.error ?? "unknown"}`);
    }
    prompt = first.compiledPrompt;
  }

  if (!prompt) throw new Error(`Case ${evalCase.name}: no prompt resolved`);

  // Build subagent task — model from case or env default
  const model = input.model || config.modelTaskExecution;
  const task: Record<string, unknown> = {
    prompt,
    model,
  };
  if (input.outputSchema) task.outputSchema = input.outputSchema;
  if (input.maxRetries) task.maxRetries = input.maxRetries;

  // Call subagent
  const { subagentMcp } = await import("@/lib/mcp/static/subagent.js");
  const result = await subagentMcp.callTool("run_text", { tasks: [task] });

  const text = result.content?.[0];
  if (!text || !("text" in text)) throw new Error("Subagent returned no content");
  const output = JSON.parse(text.text as string) as Array<{
    status: string;
    result?: string;
    error?: string;
    validated?: boolean;
    attempts?: number;
  }>;
  const first = output[0];
  if (!first) throw new Error("Subagent returned empty output array");

  // Build trace
  const trace: Trace = {
    caseFile: evalCase.name,
    mode: "unit",
    runIndex,
    timestamp: new Date().toISOString(),
    input: { message: prompt, model },
    totalDurationMs: Date.now() - t0,
    unitResult: {
      raw: first.result ?? first.error ?? "",
      validated: first.validated ?? false,
      attempts: first.attempts ?? 1,
    },
  };

  // Try to parse JSON if schema was provided
  if (input.outputSchema && first.status === "ok" && first.result) {
    try {
      trace.unitResult!.parsed = JSON.parse(first.result);
    } catch {
      trace.unitResult!.schemaErrors = ["JSON parse failed on result"];
    }
  }

  if (first.status === "error") {
    trace.unitResult!.schemaErrors = [first.error ?? "unknown error"];
  }

  return trace;
}
