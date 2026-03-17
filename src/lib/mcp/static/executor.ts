import { z } from "zod";
import type { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types";
import type { McpProvider, ToolContext } from "../types";
import { runExecutor } from "@/lib/agent/executor";
import type { ExecutorResult } from "@/lib/agent/executor";
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

const TaskSchema = z.object({
  instruction: z.string().min(1),
  mcpScope: z.array(z.string()).min(1),
  model: z.string().optional(),
  maxIterations: z.number().int().min(1).max(100).optional(),
  timeout: z.number().positive().optional(),
  context: z.string().optional(),
  skills: z.array(z.string()).optional(),
});

const RunSyncParams = z.object({
  tasks: z.array(TaskSchema).min(1, "tasks array must not be empty"),
});

const RunAsyncParams = z.object({
  tasks: z.array(TaskSchema).min(1, "tasks array must not be empty"),
});

const GetResultParams = z.object({
  taskId: z.string().optional(),
  taskIds: z.array(z.string()).optional(),
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

interface RaceOk<T> {
  timedOut: false;
  value: T;
}
interface RaceTimeout {
  timedOut: true;
}

/**
 * Race a promise against a timeout. If the timeout fires first,
 * the original promise keeps running — it is NOT cancelled.
 */
function raceTimeout<T>(
  promise: Promise<T>,
  ms: number,
): Promise<RaceOk<T> | RaceTimeout> {
  let timer: ReturnType<typeof setTimeout>;

  const timeout = new Promise<RaceTimeout>((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), ms);
  });

  const wrapped = promise.then(
    (value): RaceOk<T> => {
      clearTimeout(timer);
      return { timedOut: false, value };
    },
    (err: unknown) => {
      clearTimeout(timer);
      throw err; // re-throw — allSettled will catch it
    },
  );

  return Promise.race([wrapped, timeout]);
}

/**
 * Persist executor result to a Task row (used by both async and timeout-promoted tasks).
 */
async function persistExecutorResult(
  taskId: string,
  result: ExecutorResult,
): Promise<void> {
  await prisma.task.update({
    where: { id: taskId },
    data: {
      status: result.status === "completed" ? "completed" : "failed",
      reply: result.output || null,
      error: result.error ?? null,
      executorResult: result as unknown as Prisma.InputJsonValue,
    },
  });
}

/* ------------------------------------------------------------------ */
/*  Async executor: fire-and-forget wrapper                            */
/* ------------------------------------------------------------------ */

async function runAsyncExecutor(
  taskId: string,
  task: z.infer<typeof TaskSchema>,
  toolContext?: ToolContext,
): Promise<void> {
  try {
    await prisma.task.update({
      where: { id: taskId },
      data: { status: "running" },
    });

    const result = await runExecutor(task, toolContext);
    await persistExecutorResult(taskId, result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[executor:${taskId}]`, err);
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
          } satisfies ExecutorResult as unknown as Prisma.InputJsonValue,
        },
      })
      .catch(() => {
        /* best effort */
      });
  }
}

/* ------------------------------------------------------------------ */
/*  Tool input schema fragments (reused across tools)                  */
/* ------------------------------------------------------------------ */

const TASK_ITEM_SCHEMA = {
  type: "object" as const,
  properties: {
    instruction: {
      type: "string",
      description:
        "Concrete instruction for the executor — what to do, not why",
    },
    mcpScope: {
      type: "array",
      items: { type: "string" },
      description:
        'MCP provider names whose tools the executor can use (e.g. ["video_mgr", "biz_db"])',
    },
    model: {
      type: "string",
      description: "LLM model for the executor (default: system default)",
    },
    maxIterations: {
      type: "number",
      description: "Max tool-use iterations (default: 20, max: 100)",
    },
    timeout: {
      type: "number",
      description:
        "Timeout in seconds. For run_sync: if exceeded, the task is automatically " +
        "promoted to async — execution continues in background and a taskId is " +
        "returned for later retrieval via get_result. No timeout by default.",
    },
    context: {
      type: "string",
      description:
        "Additional context for the executor (e.g. data from key resources)",
    },
    skills: {
      type: "array",
      items: { type: "string" },
      description:
        "Skill names whose content will be injected as reference material " +
        "for the executor. The executor receives the content transparently " +
        "without any awareness of the skill system.",
    },
  },
  required: ["instruction", "mcpScope"],
};

/* ------------------------------------------------------------------ */
/*  Provider                                                           */
/* ------------------------------------------------------------------ */

export const executorMcp: McpProvider = {
  name: "executor",

  async listTools(): Promise<Tool[]> {
    return [
      {
        name: "run_sync",
        description:
          "Run one or more executor tasks synchronously. Each executor is an independent " +
          "lightweight agent with its own tool-use loop, using the specified MCP tools and " +
          "a cheaper model. All tasks execute concurrently; the call blocks until all " +
          "complete. Use this when you need results before proceeding.",
        inputSchema: {
          type: "object" as const,
          properties: {
            tasks: {
              type: "array",
              description: "Array of executor tasks to run concurrently",
              items: TASK_ITEM_SCHEMA,
            },
          },
          required: ["tasks"],
        },
      },
      {
        name: "run_async",
        description:
          "Start one or more executor tasks asynchronously. Returns task IDs immediately " +
          "without waiting for completion. Use `executor__get_result` to check status and " +
          "retrieve results later. Use this for long-running tasks when you can continue " +
          "other work in parallel.",
        inputSchema: {
          type: "object" as const,
          properties: {
            tasks: {
              type: "array",
              description: "Array of executor tasks to start concurrently",
              items: TASK_ITEM_SCHEMA,
            },
          },
          required: ["tasks"],
        },
      },
      {
        name: "get_result",
        description:
          "Get the result of one or more async executor tasks. Returns status and result " +
          "for each task. Supports batch queries to reduce round-trips.",
        inputSchema: {
          type: "object" as const,
          properties: {
            taskId: {
              type: "string",
              description: "Single task ID to query",
            },
            taskIds: {
              type: "array",
              items: { type: "string" },
              description: "Multiple task IDs to query in batch",
            },
          },
        },
      },
      {
        name: "schedule",
        description:
          "Schedule an executor task to run at a future time (one-time) or on a recurring " +
          "cron schedule. The task will be executed automatically by the scheduler service. " +
          "Returns a schedule ID for management. Use `cancel_schedule` to stop.",
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
        description: "Cancel a scheduled executor task by its schedule ID.",
        inputSchema: {
          type: "object" as const,
          properties: {
            scheduleId: {
              type: "string",
              description: "The schedule ID returned by `executor__schedule`",
            },
          },
          required: ["scheduleId"],
        },
      },
      {
        name: "list_schedules",
        description:
          "List all scheduled executor tasks with their status, next run time, and last execution info.",
        inputSchema: {
          type: "object" as const,
          properties: {},
        },
      },
      {
        name: "wait",
        description:
          "Wait for the specified number of seconds before continuing. Use this when you " +
          "need to give async executors time to complete before checking results with " +
          "`executor__get_result`. Max 300 seconds (5 minutes).",
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
      /*  run_sync — block until all executors complete                */
      /* ------------------------------------------------------------ */
      case "run_sync": {
        const { tasks } = RunSyncParams.parse(args);
        const sessionId = context?.sessionId;

        const results = await Promise.allSettled(
          tasks.map(async (t) => {
            const timeoutSec = t.timeout;

            // No timeout — wait indefinitely
            if (!timeoutSec) {
              return { ...await runExecutor(t, context), promoted: false as const };
            }

            // Race executor against timeout
            const executorPromise = runExecutor(t, context);
            const race = await raceTimeout(executorPromise, timeoutSec * 1000);

            if (!race.timedOut) {
              return { ...race.value, promoted: false as const };
            }

            // Timeout reached — promote to async
            if (!sessionId) {
              // No session → can't create Task for later retrieval
              // Wait for executor to finish (no promotion possible)
              const result = await executorPromise;
              return { ...result, promoted: false as const };
            }

            // Create Task record; executor continues in background
            const taskRow = await prisma.task.create({
              data: {
                sessionId,
                type: "executor",
                status: "running",
                input: t as unknown as Prisma.InputJsonValue,
              },
            });

            // Attach result handler to the still-running executor
            void executorPromise
              .then((r) => persistExecutorResult(taskRow.id, r))
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
            status: "failed" as const,
            output: "",
            error:
              r.reason instanceof Error
                ? r.reason.message
                : String(r.reason),
            toolCallCount: 0,
            model: tasks[i]?.model ?? "unknown",
            durationMs: 0,
          };
        });

        return json(output);
      }

      /* ------------------------------------------------------------ */
      /*  run_async — fire-and-forget, return task IDs                */
      /* ------------------------------------------------------------ */
      case "run_async": {
        const { tasks } = RunAsyncParams.parse(args);

        const sessionId = context?.sessionId;
        if (!sessionId) {
          return text("Cannot run async executor: no session context");
        }

        const launched: { index: number; taskId: string; status: string }[] =
          [];

        for (let i = 0; i < tasks.length; i++) {
          const t = tasks[i]!;
          const task = await prisma.task.create({
            data: {
              sessionId,
              type: "executor",
              status: "pending",
              input: t as unknown as Prisma.InputJsonValue,
            },
          });

          // Fire-and-forget
          void runAsyncExecutor(task.id, t, context);

          launched.push({ index: i, taskId: task.id, status: "running" });
        }

        return json(launched);
      }

      /* ------------------------------------------------------------ */
      /*  get_result — query async executor status/results            */
      /* ------------------------------------------------------------ */
      case "get_result": {
        const parsed = GetResultParams.parse(args);
        const ids: string[] = [];
        if (parsed.taskId) ids.push(parsed.taskId);
        if (parsed.taskIds) ids.push(...parsed.taskIds);
        if (ids.length === 0) return text("No task IDs provided");

        const rows = await prisma.task.findMany({
          where: { id: { in: ids }, type: "executor" },
          select: {
            id: true,
            status: true,
            reply: true,
            error: true,
            executorResult: true,
          },
        });

        const byId = new Map(rows.map((r) => [r.id, r]));

        const results = ids.map((id) => {
          const row = byId.get(id);
          if (!row) return { taskId: id, status: "not_found" };

          // Terminal states — return full result
          if (row.status === "completed" || row.status === "failed") {
            const stored = row.executorResult as Record<
              string,
              unknown
            > | null;
            if (stored) {
              return { taskId: id, ...stored };
            }
            // Fallback if executorResult wasn't stored
            return {
              taskId: id,
              status: row.status,
              output: row.reply ?? "",
              error: row.error ?? undefined,
            };
          }

          // Still running
          return { taskId: id, status: row.status };
        });

        return json(results);
      }

      /* ------------------------------------------------------------ */
      /*  schedule — register a cron/one-time scheduled executor       */
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

      /* ------------------------------------------------------------ */
      /*  cancel_schedule — stop a scheduled task                     */
      /* ------------------------------------------------------------ */
      case "cancel_schedule": {
        const { scheduleId } = CancelScheduleParams.parse(args);
        const result = await cancelSchedule(scheduleId);
        if (!result.found) {
          return text(`Schedule not found: ${scheduleId}`);
        }
        return json({ scheduleId, status: "cancelled" });
      }

      /* ------------------------------------------------------------ */
      /*  list_schedules — list all scheduled tasks                   */
      /* ------------------------------------------------------------ */
      case "list_schedules": {
        const schedules = await listSchedules();
        return json(schedules);
      }

      /* ------------------------------------------------------------ */
      /*  wait — sleep before checking async results                   */
      /* ------------------------------------------------------------ */
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
