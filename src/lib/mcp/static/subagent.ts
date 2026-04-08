import { z } from "zod";
import type { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types";
import type { McpProvider, ToolContext } from "../types";
import {
  runSubAgent,
  getActiveSubAgent,
  getTraceTree,
  MAX_SUBAGENT_DEPTH,
  type SubAgentResult,
  type SubAgentProgressCallbacks,
} from "@/lib/agent/subagent";
import { SUBAGENT_DEFAULT_MODEL, type ModelUsageType } from "@/lib/agent/models";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma";
import {
  createSchedule,
  cancelSchedule,
  listSchedules,
} from "@/lib/services/scheduler-service";

function text(t: string): CallToolResult {
  return { content: [{ type: "text", text: t }] };
}

function json(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
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
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<RaceTimeout>((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), ms);
  });
  const wrapped = promise.then(
    (value): RaceOk<T> => { clearTimeout(timer); return { timedOut: false, value }; },
    (err: unknown) => { clearTimeout(timer); throw err; },
  );
  return Promise.race([wrapped, timeout]);
}

/* ------------------------------------------------------------------ */
/*  DB persistence helper                                              */
/* ------------------------------------------------------------------ */

async function persistResult(
  taskId: string,
  result: SubAgentResult,
): Promise<void> {
  await prisma.task.update({
    where: { id: taskId },
    data: {
      status: result.status === "completed" ? "completed" : "failed",
      reply: result.output || null,
      error: result.error ?? null,
      // Persist full result including trace for post-mortem debugging
      executorResult: result as unknown as Prisma.InputJsonValue,
    },
  });
}

/* ------------------------------------------------------------------ */
/*  Async runner                                                       */
/* ------------------------------------------------------------------ */

async function runAsyncSubAgent(
  taskId: string,
  task: z.infer<typeof TaskSchema>,
  taskIndex: number,
  toolContext?: ToolContext,
): Promise<void> {
  const t0 = Date.now();
  try {
    await prisma.task.update({
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
      },
    });

    await prisma.task
      .update({
        where: { id: taskId },
        data: {
          status: "failed",
          error: message,
          executorResult: {
            status: "failed",
            output: "",
            error: message,
            toolCallCount: 0,
            model: task.model ?? "unknown",
            durationMs: 0,
          } as unknown as Prisma.InputJsonValue,
        },
      })
      .catch(() => { /* best effort */ });
  }
}

/* ------------------------------------------------------------------ */
/*  Format result for LLM consumption                                  */
/* ------------------------------------------------------------------ */

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
        "LLM model override. The system auto-selects a model based on usageType. " +
        "Only specify when the user explicitly requests a model or a skill mandates one.",
    },
    usageType: {
      type: "string",
      enum: ["task-execution", "prompt-execution", "controller", "utility"],
      description:
        "Model routing category. Auto-inferred when omitted: " +
        "tool-loop (mcpScope set) → 'task-execution', single-shot → 'prompt-execution'. " +
        "Rarely needs to be set manually.",
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
        "When set, the successful result is persisted as a key JSON resource. " +
        "Same session + same title = upsert.",
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
          "or taskId for completed async tasks stored in DB.",
        inputSchema: {
          type: "object" as const,
          properties: {
            agentId: {
              type: "string",
              description: "In-memory agent ID (returned by run/continue)",
            },
            taskId: {
              type: "string",
              description: "DB task ID (for async tasks)",
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
          "Schedule a subagent task to run at a future time (one-time) or on a recurring " +
          "cron schedule. Returns a schedule ID. Use `cancel_schedule` to stop.",
        inputSchema: {
          type: "object" as const,
          properties: {
            task: TASK_ITEM_SCHEMA,
            cron: {
              type: "string",
              description:
                'Cron expression for recurring execution (e.g. "0 9 * * *" = daily at 9am). ' +
                "Mutually exclusive with runAt.",
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
        description: "List all scheduled subagent tasks with status and next run time.",
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
        const sessionId = context?.sessionId;
        const currentDepth = context?.agentDepth ?? 0;

        // Enforce nesting depth limit
        if (currentDepth >= MAX_SUBAGENT_DEPTH) {
          return text(
            `SubAgent nesting depth limit reached (max ${MAX_SUBAGENT_DEPTH}). ` +
            `Current depth: ${currentDepth}. Simplify your task decomposition.`,
          );
        }

        context?.onProgress?.({
          type: "subagent_tasks",
          data: {
            tasks: tasks.map((t, i) => ({
              index: i,
              instruction: t.instruction.slice(0, 80),
              model: t.model ?? SUBAGENT_DEFAULT_MODEL,
              mcpScope: t.mcpScope ?? [],
              mode: t.mcpScope?.length ? "tool-loop" : "single-shot",
            })),
          },
        });

        const results = await Promise.allSettled(
          tasks.map(async (t, i) => {
            const timeoutSec = t.timeout;

            const progressCbs: SubAgentProgressCallbacks = {
              onToolStart: (toolName, iteration) => {
                context?.onProgress?.({
                  type: "subagent_step",
                  data: { taskIndex: i, tool: toolName, iteration, action: "start" },
                });
              },
              onToolEnd: (toolName, durationMs, error) => {
                context?.onProgress?.({
                  type: "subagent_step",
                  data: { taskIndex: i, tool: toolName, durationMs, action: "end", error },
                });
              },
            };

            const emitDone = (result: SubAgentResult & { agentId: string }) => {
              context?.onProgress?.({
                type: "subagent_task_done",
                data: {
                  index: i,
                  status: result.status === "completed" ? "ok" : result.status,
                  durationMs: result.durationMs,
                  toolCallCount: result.toolCallCount,
                  agentId: result.agentId,
                },
              });
            };

            if (!timeoutSec) {
              const result = await runSubAgent(t, context, progressCbs);
              emitDone(result);
              return { ...formatResult(result, t.includeTrace), promoted: false as const };
            }

            const agentPromise = runSubAgent(t, context, progressCbs);
            const race = await raceTimeout(agentPromise, timeoutSec * 1000);

            if (!race.timedOut) {
              emitDone(race.value);
              return { ...formatResult(race.value, t.includeTrace), promoted: false as const };
            }

            if (!sessionId) {
              const result = await agentPromise;
              emitDone(result);
              return { ...formatResult(result, t.includeTrace), promoted: false as const };
            }

            const taskRow = await prisma.task.create({
              data: {
                sessionId,
                type: "subagent",
                status: "running",
                input: t as unknown as Prisma.InputJsonValue,
              },
            });

            void agentPromise
              .then((r) => persistResult(taskRow.id, r))
              .catch(async (err: unknown) => {
                const msg = err instanceof Error ? err.message : String(err);
                await prisma.task
                  .update({
                    where: { id: taskRow.id },
                    data: { status: "failed", error: msg },
                  })
                  .catch(() => {});
              });

            return {
              status: "timeout" as const,
              output: "",
              taskId: taskRow.id,
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
        const sessionId = context?.sessionId;
        if (!sessionId) {
          return text("Cannot run async subagent: no session context");
        }

        context?.onProgress?.({
          type: "subagent_tasks",
          data: {
            tasks: tasks.map((t, i) => ({
              index: i,
              instruction: t.instruction.slice(0, 80),
              model: t.model ?? SUBAGENT_DEFAULT_MODEL,
              mcpScope: t.mcpScope ?? [],
              mode: t.mcpScope?.length ? "tool-loop" : "single-shot",
            })),
          },
        });

        const launched: { index: number; taskId: string; status: string }[] = [];

        for (let i = 0; i < tasks.length; i++) {
          const t = tasks[i]!;
          const task = await prisma.task.create({
            data: {
              sessionId,
              type: "subagent",
              status: "pending",
              input: t as unknown as Prisma.InputJsonValue,
            },
          });

          void runAsyncSubAgent(task.id, t, i, context);
          launched.push({ index: i, taskId: task.id, status: "running" });
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

        const rows = await prisma.task.findMany({
          where: { id: { in: ids }, type: { in: ["executor", "subagent"] } },
          select: {
            id: true, status: true, reply: true,
            error: true, executorResult: true,
          },
        });

        const byId = new Map(rows.map((r) => [r.id, r]));
        const results = ids.map((id) => {
          const row = byId.get(id);
          if (!row) return { taskId: id, status: "not_found" };
          if (row.status === "completed" || row.status === "failed") {
            const stored = row.executorResult as Record<string, unknown> | null;
            return stored
              ? { taskId: id, ...stored }
              : { taskId: id, status: row.status, output: row.reply ?? "", error: row.error ?? undefined };
          }
          return { taskId: id, status: row.status };
        });

        return json(results);
      }

      /* ------------------------------------------------------------ */
      /*  get_trace — white-box debugging                             */
      /* ------------------------------------------------------------ */
      case "get_trace": {
        const parsed = GetTraceParams.parse(args);

        if (parsed.agentId) {
          // Tree mode: recursively collect child traces
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
          const row = await prisma.task.findUnique({
            where: { id: parsed.taskId },
            select: { executorResult: true, status: true },
          });
          if (!row) return text(`Task "${parsed.taskId}" not found`);
          if (row.status === "running" || row.status === "pending") {
            return text(`Task "${parsed.taskId}" is still ${row.status} — trace not yet available`);
          }
          // DB now includes full trace (persisted at task completion)
          const stored = row.executorResult as Record<string, unknown> | null;
          if (stored?.trace) return json(stored.trace);
          return json({ note: "Legacy task — trace not available", result: stored });
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

        const progressCbs: SubAgentProgressCallbacks = {
          onToolStart: (toolName, iteration) => {
            context?.onProgress?.({
              type: "subagent_step",
              data: { taskIndex: 0, tool: toolName, iteration, action: "start" },
            });
          },
          onToolEnd: (toolName, durationMs, error) => {
            context?.onProgress?.({
              type: "subagent_step",
              data: { taskIndex: 0, tool: toolName, durationMs, action: "end", error },
            });
          },
        };

        const result = await agent.continue(feedback, context, progressCbs);

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
        const info = await createSchedule({
          task: parsed.task,
          cron: parsed.cron,
          runAt: parsed.runAt,
          sessionId: context?.sessionId,
        });
        return json(info);
      }

      case "cancel_schedule": {
        const { scheduleId } = CancelScheduleParams.parse(args);
        const result = await cancelSchedule(scheduleId);
        if (!result.found) return text(`Schedule not found: ${scheduleId}`);
        return json({ scheduleId, status: "cancelled" });
      }

      case "list_schedules": {
        const schedules = await listSchedules();
        return json(schedules);
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
