import type { Trace, EvalCase, TraceInput } from "../types.js";
import { collectTrace } from "./trace-collector.js";

const DEFAULT_API = "http://localhost:8001";

/**
 * Run a trace-mode eval case via HTTP API.
 */
export async function runTraceCase(
  evalCase: EvalCase,
  runIndex: number,
  apiUrl: string = DEFAULT_API,
): Promise<Trace> {
  const input = evalCase.input as TraceInput;
  if (!input?.message) throw new Error(`Case ${evalCase.name}: missing input.message`);

  const t0 = Date.now();

  const body: Record<string, unknown> = {
    message: input.message,
  };
  if (input.skills) body.skills = input.skills;
  if (input.video_context) body.video_context = input.video_context;

  const submitRes = await fetch(`${apiUrl}/api/video/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!submitRes.ok) {
    const err = await submitRes.text();
    throw new Error(`Task submit failed: ${submitRes.status} ${err}`);
  }
  const { task_id } = (await submitRes.json()) as { task_id: string; session_id: string };

  const collected = await collectTrace(apiUrl, task_id);

  return {
    caseFile: evalCase.name,
    mode: evalCase.mode,
    runIndex,
    timestamp: new Date().toISOString(),
    input: {
      message: input.message,
      skills: input.skills,
      videoContext: input.video_context as Record<string, unknown> | undefined,
    },
    toolCalls: collected.toolCalls,
    reply: collected.reply,
    iterations: collected.toolCalls.length > 0
      ? Math.max(...collected.toolCalls.map((tc) => tc.iteration)) + 1
      : 1,
    totalDurationMs: Date.now() - t0,
  };
}

/**
 * Run a workflow-mode eval case (multi-step) via HTTP API.
 */
export async function runWorkflowCase(
  evalCase: EvalCase,
  runIndex: number,
  apiUrl: string = DEFAULT_API,
): Promise<Trace[]> {
  const steps = evalCase.steps;
  if (!steps?.length) throw new Error(`Case ${evalCase.name}: no steps defined`);

  const ctx = evalCase.context;
  const traces: Trace[] = [];
  let sessionId: string | undefined;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    const t0 = Date.now();

    const body: Record<string, unknown> = {
      message: step.message,
    };
    if (sessionId) body.session_id = sessionId;
    if (ctx?.skills) body.skills = ctx.skills;
    if (ctx?.video_context) body.video_context = ctx.video_context;

    const submitRes = await fetch(`${apiUrl}/api/video/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!submitRes.ok) {
      const err = await submitRes.text();
      throw new Error(`Workflow step ${i} submit failed: ${submitRes.status} ${err}`);
    }
    const result = (await submitRes.json()) as { task_id: string; session_id: string };
    if (!sessionId) sessionId = result.session_id;

    const collected = await collectTrace(apiUrl, result.task_id);

    traces.push({
      caseFile: `${evalCase.name}[step-${i}]`,
      mode: "workflow",
      runIndex,
      timestamp: new Date().toISOString(),
      input: {
        message: step.message,
        skills: ctx?.skills,
        videoContext: ctx?.video_context as Record<string, unknown> | undefined,
      },
      toolCalls: collected.toolCalls,
      reply: collected.reply,
      iterations: collected.toolCalls.length > 0
        ? Math.max(...collected.toolCalls.map((tc) => tc.iteration)) + 1
        : 1,
      totalDurationMs: Date.now() - t0,
    });
  }

  return traces;
}
