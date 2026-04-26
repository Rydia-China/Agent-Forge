import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types";
import type { McpProvider, ToolContext } from "../types";
import {
  runSubAgent,
  getActiveSubAgent,
  getTraceTree,
  MAX_SUBAGENT_DEPTH,
  type ModelUsageType,
  type SubAgentResult,
  type SubAgentProgressCallbacks,
} from "@/lib/agent/subagent";
import { resolveModel } from "@/lib/agent/models";
import type { PrismaClient } from "@/generated/prisma";

function text(t: string): CallToolResult {
  return { content: [{ type: "text", text: t }] };
}

function json(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

/* ------------------------------------------------------------------ */
/*  JSON helpers                                                       */
/* ------------------------------------------------------------------ */

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  if (typeof value === "object") {
    return Object.values(value).every(isJsonValue);
  }
  return false;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value) && isJsonValue(value);
}

function normalizeJsonObject(value: unknown): JsonObject {
  const normalized: unknown = JSON.parse(JSON.stringify(value));
  return isJsonObject(normalized) ? normalized : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type GetOrCreateSessionFn =
  typeof import("@/lib/services/chat-session-service").getOrCreateSession;

async function getPrisma(): Promise<PrismaClient> {
  const db = await import("@/lib/db");
  return db.prisma;
}

async function getSessionResolver(): Promise<GetOrCreateSessionFn> {
  const service = await import("@/lib/services/chat-session-service");
  return service.getOrCreateSession;
}

/* ------------------------------------------------------------------ */
/*  Zod schemas                                                        */
/* ------------------------------------------------------------------ */

const USAGE_TYPES: [ModelUsageType, ...ModelUsageType[]] = [
  "task-execution",
  "prompt-execution",
  "controller",
  "utility",
];

const TaskSchema = z.object({
  instruction: z.string().min(1),
  mcpScope: z.array(z.string()).optional(),
  model: z.string().optional(),
  usageType: z.enum(USAGE_TYPES).optional(),
  maxIterations: z.number().int().min(1).max(100).optional(),
  timeout: z.number().positive().optional(),
  context: z.string().optional(),
  skills: z.array(z.string()).optional(),
  outputSchema: z.record(z.string(), z.unknown()).optional(),
  maxRetries: z.number().int().min(1).max(5).optional(),
  imageUrls: z.array(z.string().url()).optional(),
  keyJsonTitle: z.string().min(1).optional(),
  includeTrace: z.boolean().optional(),
});

type TaskInput = z.infer<typeof TaskSchema>;

const RunParams = z.object({
  tasks: z.array(TaskSchema).min(1, "tasks array must not be empty"),
});

const GetResultParams = z.object({
  taskId: z.string().optional(),
  taskIds: z.array(z.string()).optional(),
});

const GetTraceParams = z.object({
  agentId: z.string().optional(),
  taskId: z.string().optional(),
  tree: z.boolean().optional(),
});

const ContinueParams = z.object({
  agentId: z.string().min(1),
  feedback: z.string().min(1),
  includeTrace: z.boolean().optional(),
});

const ScheduleParams = z.object({
  task: TaskSchema,
  cron: z.string().optional(),
  runAt: z.string().optional(),
});

const CancelScheduleParams = z.object({
  scheduleId: z.string().min(1),
});

const WaitParams = z.object({
  seconds: z.number().positive().max(300),
});

/* ------------------------------------------------------------------ */
/*  Timeout racing helper                                              */
/* ------------------------------------------------------------------ */

interface RaceOk<T> { timedOut: false; value: T }
interface RaceTimeout { timedOut: true }

function raceTimeout<T>(
  promise: Promise<T>,
  ms: number,
): Promise<RaceOk<T> | RaceTimeout> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<RaceTimeout>((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), ms);
  });
  const wrapped = promise.then(
    (value): RaceOk<T> => {
      if (timer) clearTimeout(timer);
      return { timedOut: false, value };
    },
    (err: unknown) => {
      if (timer) clearTimeout(timer);
      throw err;
    },
  );
  return Promise.race([wrapped, timeout]);
}

/* ------------------------------------------------------------------ */
/*  Async persistence                                                  */
/* ------------------------------------------------------------------ */

function dbStatusFromResult(status: SubAgentResult["status"]): string {
  return status;
}

function publicStatus(status: string): string {
  return status === "completed" ? "ok" : status;
}

function formatResult(
  result: SubAgentResult & { agentId: string },
  includeTrace?: boolean,
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    status: result.status === "completed" ? "ok" : result.status,
    result: result.output,
    agentId: result.agentId,
    model: result.model,
    durationMs: result.durationMs,
    toolCallCount: result.toolCallCount,
  };
  if (result.error) base.error = result.error;
  if (result.validated !== undefined) base.validated = result.validated;
  if (result.attempts !== undefined) base.attempts = result.attempts;
  if (result.keyJsonTitle) base.keyJsonTitle = result.keyJsonTitle;
  if (includeTrace) base.trace = result.trace;
  return base;
}

async function createAsyncRecord(
  task: TaskInput,
  context?: ToolContext,
): Promise<string> {
  const getOrCreateSession = await getSessionResolver();
  const prisma = await getPrisma();
  const session = await getOrCreateSession(context?.sessionId, context?.userName);
  const row = await prisma.subAgent.create({
    data: {
      sessionId: session.id,
      depth: context?.agentDepth ?? 0,
      status: "pending",
      config: normalizeJsonObject({ source: "mcp.subagent", task }),
    },
    select: { id: true },
  });
  return row.id;
}

async function persistResult(
  taskId: string,
  result: SubAgentResult & { agentId: string },
): Promise<void> {
  const prisma = await getPrisma();
  await prisma.subAgent.update({
    where: { id: taskId },
    data: {
      status: dbStatusFromResult(result.status),
      output: result.output || null,
      error: result.error ?? null,
      trace: normalizeJsonObject(formatResult(result, true)),
    },
  });
}

async function persistFailure(
  taskId: string,
  error: string,
  model: string,
  durationMs: number,
): Promise<void> {
  const prisma = await getPrisma();
  await prisma.subAgent.update({
    where: { id: taskId },
    data: {
      status: "failed",
      output: null,
      error,
      trace: normalizeJsonObject({
        status: "failed",
        result: "",
        error,
        model,
        durationMs,
        toolCallCount: 0,
      }),
    },
  });
}

async function runAsyncSubAgent(
  taskId: string,
  task: TaskInput,
  taskIndex: number,
  toolContext?: ToolContext,
): Promise<void> {
  const t0 = Date.now();
  try {
    const prisma = await getPrisma();
    await prisma.subAgent.update({
      where: { id: taskId },
      data: { status: "running" },
    });

    const progressCbs: SubAgentProgressCallbacks = {
      onToolStart: (toolName, iteration) => {
        toolContext?.onProgress?.({
          type: "subagent_step",
          data: { taskIndex, tool: toolName, iteration, action: "start" },
        });
      },
      onToolEnd: (toolName, durationMs, error) => {
        toolContext?.onProgress?.({
          type: "subagent_step",
          data: { taskIndex, tool: toolName, durationMs, action: "end", error },
        });
      },
    };

    const result = await runSubAgent(task, toolContext, progressCbs);
    await persistResult(taskId, result);

    toolContext?.onProgress?.({
      type: "subagent_task_done",
      data: {
        index: taskIndex,
        status: result.status === "completed" ? "ok" : result.status,
        durationMs: result.durationMs,
        toolCallCount: result.toolCallCount,
        agentId: result.agentId,
        taskId,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[subagent:${taskId}]`, err);

    toolContext?.onProgress?.({
      type: "subagent_task_done",
      data: {
        index: taskIndex,
        status: "failed",
        durationMs: Date.now() - t0,
        toolCallCount: 0,
        taskId,
      },
    });

    await persistFailure(taskId, message, resolveModel(task.model), Date.now() - t0)
      .catch(() => { /* best effort */ });
  }
}

async function launchAsyncTask(
  task: TaskInput,
  taskIndex: number,
  context?: ToolContext,
  onDone?: (taskId: string) => void,
): Promise<string> {
  const taskId = await createAsyncRecord(task, context);
  void runAsyncSubAgent(taskId, task, taskIndex, context)
    .then(() => onDone?.(taskId))
    .catch((err: unknown) => {
      console.error(`[subagent:${taskId}] async launcher failed`, err);
    });
  return taskId;
}

/* ------------------------------------------------------------------ */
/*  In-memory schedules                                                */
/* ------------------------------------------------------------------ */

type ScheduleStatus = "scheduled" | "running" | "completed" | "failed" | "cancelled";

interface ScheduleRecord {
  id: string;
  task: TaskInput;
  status: ScheduleStatus;
  runAt: string;
  createdAt: string;
  sessionId?: string;
  taskId?: string;
  error?: string;
  timer: ReturnType<typeof setTimeout>;
}

declare global {
  var __agentForgeSubagentSchedules: Map<string, ScheduleRecord> | undefined;
}

const schedules = globalThis.__agentForgeSubagentSchedules ?? new Map<string, ScheduleRecord>();
globalThis.__agentForgeSubagentSchedules = schedules;

function serializeSchedule(record: ScheduleRecord): Record<string, unknown> {
  return {
    scheduleId: record.id,
    status: record.status,
    runAt: record.runAt,
    createdAt: record.createdAt,
    sessionId: record.sessionId,
    taskId: record.taskId,
    error: record.error,
    task: {
      instruction: record.task.instruction,
      mcpScope: record.task.mcpScope ?? [],
      model: resolveModel(record.task.model),
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Task display helpers                                               */
/* ------------------------------------------------------------------ */

function taskMode(task: TaskInput): string {
  return task.mcpScope?.length ? "tool-loop" : "single-shot";
}

function describeTask(task: TaskInput, index: number): Record<string, unknown> {
  const usageType = task.usageType ?? (task.mcpScope?.length ? "task-execution" : "prompt-execution");
  return {
    index,
    instruction: task.instruction.slice(0, 80),
    model: resolveModel(task.model),
    usageType,
    mcpScope: task.mcpScope ?? [],
    mode: taskMode(task),
  };
}

function progressCallbacks(
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

function emitDone(
  context: ToolContext | undefined,
  taskIndex: number,
  result: SubAgentResult & { agentId: string },
): void {
  context?.onProgress?.({
    type: "subagent_task_done",
    data: {
      index: taskIndex,
      status: result.status === "completed" ? "ok" : result.status,
      durationMs: result.durationMs,
      toolCallCount: result.toolCallCount,
      agentId: result.agentId,
    },
  });
}

/* ------------------------------------------------------------------ */
/*  Task input schema (shared across tools)                            */
/* ------------------------------------------------------------------ */

const TASK_ITEM_SCHEMA = {
  type: "object" as const,
  properties: {
    instruction: {
      type: "string",
      description: "Prompt (single-shot) or instruction (tool-loop) for the subagent",
    },
    mcpScope: {
      type: "array",
      items: { type: "string" },
      description:
        "MCP provider names whose tools the subagent can use. " +
        "Omit or pass empty for single-shot mode (one LLM call, no tools). " +
        'Non-empty activates tool-loop mode (e.g. ["video_workflow", "biz_db"]).',
    },
    model: {
      type: "string",
      description:
        "LLM model override. Invalid or omitted values fall back to the configured default model.",
    },
    usageType: {
      type: "string",
      enum: ["task-execution", "prompt-execution", "controller", "utility"],
      description:
        "Compatibility hint from the historical API. Current model routing uses model/default directly.",
    },
    maxIterations: {
      type: "number",
      description: "Max tool-use iterations in tool-loop mode (default 20, max 100)",
    },
    timeout: {
      type: "number",
      description:
        "Timeout in seconds. If exceeded in run, the task is automatically " +
        "promoted to async — execution continues in background and a taskId is " +
        "returned for later retrieval via get_result.",
    },
    context: {
      type: "string",
      description: "Additional context injected into the subagent's system prompt",
    },
    skills: {
      type: "array",
      items: { type: "string" },
      description: "Skill names whose content is injected as reference material",
    },
    outputSchema: {
      type: "object",
      description:
        "JSON Schema to validate subagent output against. " +
        "On validation failure, auto-retries with error context.",
    },
    maxRetries: {
      type: "number",
      description:
        "Max total attempts (including first) when outputSchema is set. Default 2, max 5.",
    },
    imageUrls: {
      type: "array",
      items: { type: "string" },
      description: "Image URLs for multimodal prompts (single-shot vision tasks)",
    },
    keyJsonTitle: {
      type: "string",
      description:
        "When set, the successful result carries a keyJsonTitle for upstream JSON resource persistence.",
    },
    includeTrace: {
      type: "boolean",
      description:
        "Include the full execution trace in the response. " +
        "Default false. Set true when debugging subagent behavior.",
    },
  },
  required: ["instruction"],
};

/* ------------------------------------------------------------------ */
/*  Provider                                                           */
/* ------------------------------------------------------------------ */

export const subagentMcp: McpProvider = {
  name: "subagent",

  async listTools(): Promise<Tool[]> {
    return [
      {
        name: "run",
        description:
          "Run one or more subagent tasks synchronously. Each subagent is an independent " +
          "lightweight agent. Mode is determined by mcpScope: omit for single-shot (one LLM call), " +
          "or specify MCP providers for tool-loop mode (multi-iteration agent with tools). " +
          "All tasks execute concurrently; the call blocks until all complete. " +
          "Each result includes an agentId for follow-up via `continue` or `get_trace`.",
        inputSchema: {
          type: "object" as const,
          properties: {
            tasks: {
              type: "array",
              description: "Array of subagent tasks to run concurrently",
              items: TASK_ITEM_SCHEMA,
            },
          },
          required: ["tasks"],
        },
      },
      {
        name: "run_async",
        description:
          "Start one or more subagent tasks asynchronously. Returns task IDs immediately " +
          "without waiting for completion. Use `subagent__get_result` to check status later. " +
          "Use this for long-running tasks when you can continue other work in parallel.",
        inputSchema: {
          type: "object" as const,
          properties: {
            tasks: {
              type: "array",
              description: "Array of subagent tasks to start concurrently",
              items: TASK_ITEM_SCHEMA,
            },
          },
          required: ["tasks"],
        },
      },
      {
        name: "get_result",
        description:
          "Get the result of one or more async subagent tasks. Returns status and result " +
          "for each task. Supports batch queries.",
        inputSchema: {
          type: "object" as const,
          properties: {
            taskId: { type: "string", description: "Single task ID to query" },
            taskIds: {
              type: "array",
              items: { type: "string" },
              description: "Multiple task IDs to query in batch",
            },
          },
        },
      },
      {
        name: "get_trace",
        description:
          "Get the full execution trace of a subagent for debugging. " +
          "Includes: complete message history, every tool call's input/output, " +
          "the system prompt used, model, iteration count. " +
          "Use agentId (from run/continue results) for in-memory agents, " +
          "or taskId for persisted async tasks.",
        inputSchema: {
          type: "object" as const,
          properties: {
            agentId: {
              type: "string",
              description: "In-memory agent ID (returned by run/continue)",
            },
            taskId: {
              type: "string",
              description: "Persisted async task ID returned by run_async or a timed-out run",
            },
            tree: {
              type: "boolean",
              description:
                "When true, recursively collect child subagent traces into a nested tree. " +
                "Use this to visualize the full subagent call hierarchy.",
            },
          },
        },
      },
      {
        name: "continue",
        description:
          "Continue a previous subagent conversation with additional feedback or instructions. " +
          "The subagent retains its full message history and resumes execution. " +
          "Use this to correct mistakes, provide missing information, or refine results " +
          "without restarting from scratch.",
        inputSchema: {
          type: "object" as const,
          properties: {
            agentId: {
              type: "string",
              description: "Agent ID returned by a previous run/continue call",
            },
            feedback: {
              type: "string",
              description: "Additional instruction or feedback to send to the subagent",
            },
            includeTrace: {
              type: "boolean",
              description: "Include full trace in response. Default false.",
            },
          },
          required: ["agentId", "feedback"],
        },
      },
      {
        name: "schedule",
        description:
          "Schedule a subagent task to run at a future time. This restored provider supports " +
          "one-time runAt schedules in memory; cron expressions return an explicit unsupported response.",
        inputSchema: {
          type: "object" as const,
          properties: {
            task: TASK_ITEM_SCHEMA,
            cron: {
              type: "string",
              description:
                'Cron expression for recurring execution (e.g. "0 9 * * *" = daily at 9am). ' +
                "Currently unsupported because the historical scheduler service no longer exists.",
            },
            runAt: {
              type: "string",
              description:
                'ISO 8601 datetime for one-time execution (e.g. "2026-03-16T09:00:00Z"). ' +
                "Mutually exclusive with cron.",
            },
          },
          required: ["task"],
        },
      },
      {
        name: "cancel_schedule",
        description: "Cancel a scheduled subagent task by its schedule ID.",
        inputSchema: {
          type: "object" as const,
          properties: {
            scheduleId: {
              type: "string",
              description: "The schedule ID returned by `subagent__schedule`",
            },
          },
          required: ["scheduleId"],
        },
      },
      {
        name: "list_schedules",
        description: "List all in-memory scheduled subagent tasks with status and next run time.",
        inputSchema: {
          type: "object" as const,
          properties: {},
        },
      },
      {
        name: "wait",
        description:
          "Wait for the specified number of seconds before continuing. Use this when you " +
          "need to give async subagents time to complete before checking results. Max 300s.",
        inputSchema: {
          type: "object" as const,
          properties: {
            seconds: {
              type: "number",
              description: "Number of seconds to wait (max 300)",
            },
          },
          required: ["seconds"],
        },
      },
    ];
  },

  async callTool(
    name: string,
    args: Record<string, unknown>,
    context?: ToolContext,
  ): Promise<CallToolResult> {
    switch (name) {
      /* ------------------------------------------------------------ */
      /*  run — unified sync execution                                */
      /* ------------------------------------------------------------ */
      case "run": {
        const { tasks } = RunParams.parse(args);
        const currentDepth = context?.agentDepth ?? 0;

        if (currentDepth >= MAX_SUBAGENT_DEPTH) {
          return text(
            `SubAgent nesting depth limit reached (max ${MAX_SUBAGENT_DEPTH}). ` +
            `Current depth: ${currentDepth}. Simplify your task decomposition.`,
          );
        }

        context?.onProgress?.({
          type: "subagent_tasks",
          data: { tasks: tasks.map(describeTask) },
        });

        const results = await Promise.allSettled(
          tasks.map(async (task, taskIndex) => {
            const timeoutSec = task.timeout;
            const callbacks = progressCallbacks(context, taskIndex);

            if (!timeoutSec) {
              const result = await runSubAgent(task, context, callbacks);
              emitDone(context, taskIndex, result);
              return { ...formatResult(result, task.includeTrace), promoted: false as const };
            }

            const agentPromise = runSubAgent(task, context, callbacks);
            const race = await raceTimeout(agentPromise, timeoutSec * 1000);

            if (!race.timedOut) {
              emitDone(context, taskIndex, race.value);
              return { ...formatResult(race.value, task.includeTrace), promoted: false as const };
            }

            const taskId = await createAsyncRecord(task, context);
            const prisma = await getPrisma();
            await prisma.subAgent.update({
              where: { id: taskId },
              data: { status: "running" },
            });
            void agentPromise
              .then((result) => persistResult(taskId, result))
              .catch(async (err: unknown) => {
                const msg = err instanceof Error ? err.message : String(err);
                await persistFailure(taskId, msg, resolveModel(task.model), timeoutSec * 1000)
                  .catch(() => { /* best effort */ });
              });

            return {
              status: "timeout" as const,
              result: "",
              taskId,
              promoted: true as const,
              durationMs: timeoutSec * 1000,
            };
          }),
        );

        const output = results.map((r, i) => {
          if (r.status === "fulfilled") {
            return { index: i, ...r.value };
          }
          return {
            index: i,
            status: "error" as const,
            result: "",
            error:
              r.reason instanceof Error ? r.reason.message : String(r.reason),
          };
        });

        return json(output);
      }

      /* ------------------------------------------------------------ */
      /*  run_async                                                    */
      /* ------------------------------------------------------------ */
      case "run_async": {
        const { tasks } = RunParams.parse(args);

        context?.onProgress?.({
          type: "subagent_tasks",
          data: { tasks: tasks.map(describeTask) },
        });

        const launched: { index: number; taskId: string; status: string }[] = [];

        for (let i = 0; i < tasks.length; i++) {
          const task = tasks[i]!;
          const taskId = await launchAsyncTask(task, i, context);
          launched.push({ index: i, taskId, status: "running" });
        }

        return json(launched);
      }

      /* ------------------------------------------------------------ */
      /*  get_result                                                   */
      /* ------------------------------------------------------------ */
      case "get_result": {
        const parsed = GetResultParams.parse(args);
        const ids: string[] = [];
        if (parsed.taskId) ids.push(parsed.taskId);
        if (parsed.taskIds) ids.push(...parsed.taskIds);
        if (ids.length === 0) return text("No task IDs provided");
        const prisma = await getPrisma();

        const rows = await prisma.subAgent.findMany({
          where: { id: { in: ids } },
          select: {
            id: true,
            status: true,
            output: true,
            error: true,
            trace: true,
            updatedAt: true,
          },
        });

        const byId = new Map(rows.map((r) => [r.id, r]));
        const results = ids.map((id) => {
          const row = byId.get(id);
          if (!row) return { taskId: id, status: "not_found" };
          if (row.status === "completed" || row.status === "failed" || row.status === "max_iterations") {
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
          return { taskId: id, status: row.status, updatedAt: row.updatedAt.toISOString() };
        });

        return json(results);
      }

      /* ------------------------------------------------------------ */
      /*  get_trace — white-box debugging                             */
      /* ------------------------------------------------------------ */
      case "get_trace": {
        const parsed = GetTraceParams.parse(args);

        if (parsed.agentId) {
          if (parsed.tree) {
            const tree = getTraceTree(parsed.agentId);
            if (tree) return json(tree);
            return text(`SubAgent "${parsed.agentId}" not found in memory`);
          }
          const agent = getActiveSubAgent(parsed.agentId);
          if (agent) return json(agent.getTrace());
          return text(`SubAgent "${parsed.agentId}" not found in memory (may have been garbage collected)`);
        }

        if (parsed.taskId) {
          const prisma = await getPrisma();
          const row = await prisma.subAgent.findUnique({
            where: { id: parsed.taskId },
            select: { trace: true, status: true, error: true },
          });
          if (!row) return text(`Task "${parsed.taskId}" not found`);
          if (row.status === "running" || row.status === "pending") {
            return json({ taskId: parsed.taskId, status: row.status, note: "trace not available until completion" });
          }
          if (isRecord(row.trace)) {
            const trace = row.trace.trace;
            return json(trace ?? row.trace);
          }
          return json({ taskId: parsed.taskId, status: row.status, error: row.error ?? undefined, trace: null });
        }

        return text("Provide either agentId or taskId");
      }

      /* ------------------------------------------------------------ */
      /*  continue — multi-turn conversation                          */
      /* ------------------------------------------------------------ */
      case "continue": {
        const { agentId, feedback, includeTrace } = ContinueParams.parse(args);

        const agent = getActiveSubAgent(agentId);
        if (!agent) {
          return text(
            `SubAgent "${agentId}" not found. It may have been garbage collected. ` +
            "Create a new subagent with `subagent__run` instead.",
          );
        }

        context?.onProgress?.({
          type: "subagent_tasks",
          data: {
            tasks: [{
              index: 0,
              instruction: `[continue] ${feedback.slice(0, 60)}`,
              model: agent.getTrace().model,
              mcpScope: [],
              mode: "continue",
            }],
          },
        });

        const result = await agent.continue(feedback, context, progressCallbacks(context, 0));

        context?.onProgress?.({
          type: "subagent_task_done",
          data: {
            index: 0,
            status: result.status === "completed" ? "ok" : result.status,
            durationMs: result.durationMs,
            toolCallCount: result.toolCallCount,
            agentId,
          },
        });

        const base: Record<string, unknown> = {
          status: result.status === "completed" ? "ok" : result.status,
          result: result.output,
          agentId,
          model: result.model,
          durationMs: result.durationMs,
          toolCallCount: result.toolCallCount,
        };
        if (result.error) base.error = result.error;
        if (includeTrace) base.trace = result.trace;
        return json(base);
      }

      /* ------------------------------------------------------------ */
      /*  schedule / cancel_schedule / list_schedules / wait           */
      /* ------------------------------------------------------------ */
      case "schedule": {
        const parsed = ScheduleParams.parse(args);
        const hasCron = typeof parsed.cron === "string" && parsed.cron.trim().length > 0;
        const hasRunAt = typeof parsed.runAt === "string" && parsed.runAt.trim().length > 0;

        if (hasCron === hasRunAt) {
          return text("Provide exactly one of cron or runAt.");
        }
        if (hasCron) {
          return json({
            status: "unsupported",
            error: "Cron scheduling was part of the removed scheduler service and is not available in the current codebase. Use runAt for one-time schedules or run_async for manual async execution.",
          });
        }

        const runAt = new Date(parsed.runAt ?? "");
        if (Number.isNaN(runAt.getTime())) {
          return text(`Invalid runAt datetime: ${parsed.runAt}`);
        }
        const delayMs = runAt.getTime() - Date.now();
        if (delayMs <= 0) {
          return text("runAt must be in the future.");
        }

        const getOrCreateSession = await getSessionResolver();
        const session = await getOrCreateSession(context?.sessionId, context?.userName);
        const scheduleId = `sched_${randomUUID()}`;
        const scheduledContext: ToolContext = {
          ...context,
          sessionId: session.id,
        };
        const timer = setTimeout(() => {
          const record = schedules.get(scheduleId);
          if (!record || record.status === "cancelled") return;
          record.status = "running";
          void launchAsyncTask(parsed.task, 0, scheduledContext, (taskId) => {
            const doneRecord = schedules.get(scheduleId);
            if (!doneRecord || doneRecord.status === "cancelled") return;
            doneRecord.taskId = taskId;
            doneRecord.status = "completed";
          })
            .then((taskId) => {
              const runningRecord = schedules.get(scheduleId);
              if (runningRecord) runningRecord.taskId = taskId;
            })
            .catch((err: unknown) => {
              const failedRecord = schedules.get(scheduleId);
              if (!failedRecord) return;
              failedRecord.status = "failed";
              failedRecord.error = err instanceof Error ? err.message : String(err);
            });
        }, delayMs);

        const record: ScheduleRecord = {
          id: scheduleId,
          task: parsed.task,
          status: "scheduled",
          runAt: runAt.toISOString(),
          createdAt: new Date().toISOString(),
          sessionId: session.id,
          timer,
        };
        schedules.set(scheduleId, record);
        return json(serializeSchedule(record));
      }

      case "cancel_schedule": {
        const { scheduleId } = CancelScheduleParams.parse(args);
        const record = schedules.get(scheduleId);
        if (!record) return text(`Schedule not found: ${scheduleId}`);
        if (record.status === "scheduled") clearTimeout(record.timer);
        record.status = "cancelled";
        return json(serializeSchedule(record));
      }

      case "list_schedules": {
        return json([...schedules.values()].map(serializeSchedule));
      }

      case "wait": {
        const { seconds } = WaitParams.parse(args);
        await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
        return text(`Waited ${seconds} seconds.`);
      }

      default:
        return text(`Unknown tool: ${name}`);
    }
  },
};
