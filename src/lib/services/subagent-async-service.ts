import type { ToolContext } from "@/lib/mcp/types";
import { runSubAgent, type SubAgentResult } from "@/lib/agent/subagent";
import { resolveModel } from "@/lib/agent/models";
import type { TaskInput } from "./subagent-task-service";
import {
  createAsyncRecord,
  persistResult,
  persistFailure,
  markTaskRunning,
} from "./subagent-persistence-service";
import { createProgressCallbacks, emitTaskDone } from "./subagent-task-service";

/* ================================================================== */
/*  Async task execution                                               */
/* ================================================================== */

/**
 * Run a subagent task asynchronously in the background.
 * Updates the database with progress and results.
 */
async function runAsyncSubAgent(
  taskId: string,
  task: TaskInput,
  taskIndex: number,
  toolContext?: ToolContext,
): Promise<void> {
  const t0 = Date.now();
  try {
    await markTaskRunning(taskId);

    const progressCbs = createProgressCallbacks(toolContext, taskIndex);
    const result = await runSubAgent(
      { ...task, persistentAgentId: taskId },
      toolContext,
      progressCbs,
    );
    await persistResult(taskId, result);

    emitTaskDone(toolContext, taskIndex, result, taskId);
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

    await persistFailure(taskId, message, resolveModel(task.model), Date.now() - t0).catch(
      () => {
        /* best effort */
      },
    );
  }
}

/**
 * Launch an async task: create DB record and start execution in background.
 * Returns the task ID immediately.
 */
export async function launchAsyncTask(
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
