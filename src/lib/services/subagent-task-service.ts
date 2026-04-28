import type { ToolContext } from "@/lib/mcp/types";
import {
  runSubAgent,
  getActiveSubAgent,
  getTraceTree,
  type SubAgentResult,
  type SubAgentProgressCallbacks,
} from "@/lib/agent/subagent";
import { resolveModel } from "@/lib/agent/models";
import {
  createSubAgentTaskRecord,
  markTaskRunning,
  persistFailure,
  persistResult,
} from "./subagent-persistence-service";

/* ================================================================== */
/*  Types                                                              */
/* ================================================================== */

export interface TaskInput {
  instruction: string;
  mcpScope?: string[];
  model?: string;
  usageType?: "task-execution" | "prompt-execution" | "controller" | "utility";
  maxIterations?: number;
  delayTime?: number;
  timeout?: number;
  context?: string;
  skills?: string[];
  outputSchema?: Record<string, unknown>;
  maxRetries?: number;
  imageUrls?: string[];
  keyJsonTitle?: string;
  includeTrace?: boolean;
}

export interface TaskResult {
  status: string;
  result: string;
  agentId: string;
  taskId?: string;
  model: string;
  durationMs: number;
  toolCallCount: number;
  error?: string;
  validated?: boolean;
  attempts?: number;
  keyJsonTitle?: string;
  trace?: unknown;
}

export interface AsyncTaskResult {
  taskId: string;
  status?: string;
  result?: string;
  error?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

/* ================================================================== */
/*  Helpers                                                            */
/* ================================================================== */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatResult(
  result: SubAgentResult & { agentId: string; taskId?: string },
  includeTrace?: boolean,
): TaskResult {
  const base: TaskResult = {
    status: result.status === "completed" ? "ok" : result.status,
    result: result.output,
    agentId: result.agentId,
    model: result.model,
    durationMs: result.durationMs,
    toolCallCount: result.toolCallCount,
  };
  if (result.error) base.error = result.error;
  if ("taskId" in result && typeof result.taskId === "string") {
    base.taskId = result.taskId;
  }
  if (result.validated !== undefined) base.validated = result.validated;
  if (result.attempts !== undefined) base.attempts = result.attempts;
  if (result.keyJsonTitle) base.keyJsonTitle = result.keyJsonTitle;
  if (includeTrace) base.trace = result.trace;
  return base;
}

function publicStatus(status: string): string {
  return status === "completed" ? "ok" : status;
}

/* ================================================================== */
/*  Progress callbacks                                                 */
/* ================================================================== */

export function createProgressCallbacks(
  context: ToolContext | undefined,
  taskIndex: number,
): SubAgentProgressCallbacks {
  return {
    onToolStart: (toolName, iteration) => {
      context?.onProgress?.({
        type: "subagent_step",
        data: { taskIndex, tool: toolName, iteration, action: "start" },
      });
    },
    onToolEnd: (toolName, durationMs, error) => {
      context?.onProgress?.({
        type: "subagent_step",
        data: { taskIndex, tool: toolName, durationMs, action: "end", error },
      });
    },
  };
}

export function emitTaskDone(
  context: ToolContext | undefined,
  taskIndex: number,
  result: SubAgentResult & { agentId: string },
  taskId?: string,
): void {
  context?.onProgress?.({
    type: "subagent_task_done",
    data: {
      index: taskIndex,
      status: result.status === "completed" ? "ok" : result.status,
      durationMs: result.durationMs,
      toolCallCount: result.toolCallCount,
      agentId: result.agentId,
      ...(taskId ? { taskId } : {}),
    },
  });
}

/* ================================================================== */
/*  Task execution                                                     */
/* ================================================================== */

/**
 * Run a subagent task synchronously (used by MCP `run` tool).
 * Returns the result immediately after completion.
 */
export async function runSubAgentTask(
  task: TaskInput,
  context?: ToolContext,
  callbacks?: SubAgentProgressCallbacks,
  options?: { persist?: boolean },
): Promise<SubAgentResult & { agentId: string; taskId?: string }> {
  if (options?.persist === false) {
    return runSubAgent(task, context, callbacks);
  }

  const taskId = await createSubAgentTaskRecord(task, context);
  const t0 = Date.now();
  try {
    await markTaskRunning(taskId);
    const result = await runSubAgent(
      { ...task, persistentAgentId: taskId },
      context,
      callbacks,
    );
    await persistResult(taskId, result);
    return { ...result, taskId };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    await persistFailure(taskId, message, resolveModel(task.model), Date.now() - t0).catch(
      () => {
        /* best effort */
      },
    );
    throw err;
  }
}

/**
 * Continue an existing subagent conversation with additional feedback.
 */
export async function continueSubAgent(
  agentId: string,
  feedback: string,
  context?: ToolContext,
  callbacks?: SubAgentProgressCallbacks,
): Promise<SubAgentResult> {
  const agent = getActiveSubAgent(agentId);
  if (!agent) {
    throw new Error(
      `SubAgent "${agentId}" not found. It may have been garbage collected.`,
    );
  }
  return agent.continue(feedback, context, callbacks);
}

/**
 * Get the execution trace of a subagent for debugging.
 * Supports both in-memory agents (agentId) and persisted tasks (taskId).
 */
export async function getSubAgentTrace(
  agentId?: string,
  taskId?: string,
  tree?: boolean,
): Promise<unknown> {
  if (agentId) {
    if (tree) {
      const traceTree = getTraceTree(agentId);
      if (!traceTree) {
        throw new Error(`SubAgent "${agentId}" not found in memory`);
      }
      return traceTree;
    }
    const agent = getActiveSubAgent(agentId);
    if (!agent) {
      throw new Error(
        `SubAgent "${agentId}" not found in memory (may have been garbage collected)`,
      );
    }
    return agent.getTrace();
  }

  if (taskId) {
    const { prisma } = await import("@/lib/db");
    const row = await prisma.subAgent.findUnique({
      where: { id: taskId },
      select: { trace: true, status: true, error: true },
    });
    if (!row) {
      throw new Error(`Task "${taskId}" not found`);
    }
    if (row.status === "running" || row.status === "pending") {
      return {
        taskId,
        status: row.status,
        note: "trace not available until completion",
      };
    }
    if (isRecord(row.trace)) {
      const trace = (row.trace as Record<string, unknown>).trace;
      return trace ?? row.trace;
    }
    return {
      taskId,
      status: row.status,
      error: row.error ?? undefined,
      trace: null,
    };
  }

  throw new Error("Provide either agentId or taskId");
}

/**
 * Get task results from database (used by MCP `get_result` tool).
 * Supports batch queries.
 */
export async function getTaskResults(taskIds: string[]): Promise<AsyncTaskResult[]> {
  if (taskIds.length === 0) {
    return [];
  }

  const { prisma } = await import("@/lib/db");
  const rows = await prisma.subAgent.findMany({
    where: { id: { in: taskIds } },
    select: {
      id: true,
      status: true,
      output: true,
      error: true,
      trace: true,
      updatedAt: true,
    },
  });

  type RowType = {
    id: string;
    status: string;
    output: string | null;
    error: string | null;
    trace: unknown;
    updatedAt: Date;
  };

  const byId = new Map<string, RowType>(
    rows.map((r: RowType) => [
      r.id,
      {
        id: r.id,
        status: r.status,
        output: r.output,
        error: r.error,
        trace: r.trace,
        updatedAt: r.updatedAt,
      },
    ]),
  );

  return taskIds.map((id): AsyncTaskResult => {
    const row = byId.get(id);
    if (!row) {
      return { taskId: id, status: "not_found" };
    }

    const isTerminal =
      row.status === "completed" ||
      row.status === "failed" ||
      row.status === "interrupted" ||
      row.status === "max_iterations";

    if (isTerminal) {
      if (isRecord(row.trace)) {
        return { taskId: id, ...row.trace };
      }
      return {
        taskId: id,
        status: publicStatus(row.status),
        result: row.output ?? "",
        error: row.error ?? undefined,
        updatedAt: row.updatedAt.toISOString(),
      };
    }

    return {
      taskId: id,
      status: row.status,
      updatedAt: row.updatedAt.toISOString(),
    };
  });
}

/* ================================================================== */
/*  Task display helpers                                               */
/* ================================================================== */

export function describeTask(task: TaskInput, index: number): Record<string, unknown> {
  const usageType =
    task.usageType ?? (task.mcpScope?.length ? "task-execution" : "prompt-execution");
  const mode = task.mcpScope?.length ? "tool-loop" : "single-shot";
  return {
    index,
    instruction: task.instruction.slice(0, 80),
    model: resolveModel(task.model),
    usageType,
    mcpScope: task.mcpScope ?? [],
    mode,
    delayTime: task.delayTime ?? 0,
  };
}

/* ================================================================== */
/*  Exports                                                            */
/* ================================================================== */

export { formatResult };
