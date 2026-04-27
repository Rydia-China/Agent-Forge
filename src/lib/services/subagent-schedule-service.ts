import { randomUUID } from "node:crypto";
import type { ToolContext } from "@/lib/mcp/types";
import { resolveModel } from "@/lib/agent/models";
import type { TaskInput } from "./subagent-task-service";

/* ================================================================== */
/*  Types                                                              */
/* ================================================================== */

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

export interface ScheduleInfo {
  scheduleId: string;
  status: ScheduleStatus;
  runAt: string;
  createdAt: string;
  sessionId?: string;
  taskId?: string;
  error?: string;
  task: {
    instruction: string;
    mcpScope: string[];
    model: string;
  };
}

/* ================================================================== */
/*  In-memory schedules (survives Next.js HMR)                        */
/* ================================================================== */

declare global {
  // eslint-disable-next-line no-var
  var __agentForgeSubagentSchedules: Map<string, ScheduleRecord> | undefined;
}

const schedules =
  globalThis.__agentForgeSubagentSchedules ?? new Map<string, ScheduleRecord>();
globalThis.__agentForgeSubagentSchedules = schedules;

/* ================================================================== */
/*  Helpers                                                            */
/* ================================================================== */

function serializeSchedule(record: ScheduleRecord): ScheduleInfo {
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

async function getSessionResolver() {
  const service = await import("@/lib/services/chat-session-service");
  return service.getOrCreateSession;
}

/* ================================================================== */
/*  Schedule operations                                                */
/* ================================================================== */

/**
 * Schedule a task to run at a specific time.
 * Returns the schedule ID.
 */
export async function scheduleTask(
  task: TaskInput,
  runAt: Date,
  context?: ToolContext,
  onTaskLaunched?: (taskId: string) => void,
): Promise<string> {
  const delayMs = runAt.getTime() - Date.now();
  if (delayMs <= 0) {
    throw new Error("runAt must be in the future");
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

    // Import and launch async task
    void import("./subagent-async-service")
      .then((mod) => mod.launchAsyncTask(task, 0, scheduledContext))
      .then((taskId) => {
        const doneRecord = schedules.get(scheduleId);
        if (!doneRecord || doneRecord.status === "cancelled") return;
        doneRecord.taskId = taskId;
        doneRecord.status = "completed";
        onTaskLaunched?.(taskId);
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
    task,
    status: "scheduled",
    runAt: runAt.toISOString(),
    createdAt: new Date().toISOString(),
    sessionId: session.id,
    timer,
  };

  schedules.set(scheduleId, record);
  return scheduleId;
}

/**
 * Cancel a scheduled task.
 * Returns the updated schedule info, or null if not found.
 */
export function cancelSchedule(scheduleId: string): ScheduleInfo | null {
  const record = schedules.get(scheduleId);
  if (!record) return null;

  if (record.status === "scheduled") {
    clearTimeout(record.timer);
  }
  record.status = "cancelled";

  return serializeSchedule(record);
}

/**
 * List all schedules.
 */
export function listSchedules(): ScheduleInfo[] {
  return [...schedules.values()].map(serializeSchedule);
}

/**
 * Get a specific schedule by ID.
 */
export function getSchedule(scheduleId: string): ScheduleInfo | null {
  const record = schedules.get(scheduleId);
  return record ? serializeSchedule(record) : null;
}
