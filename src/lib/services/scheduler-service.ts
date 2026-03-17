import { Cron } from "croner";
import { prisma } from "@/lib/db";
import { runExecutor } from "@/lib/agent/executor";
import type { ExecutorTask, ExecutorResult } from "@/lib/agent/executor";
import type { Prisma } from "@/generated/prisma";

/* ------------------------------------------------------------------ */
/*  In-memory registry (survives HMR)                                  */
/* ------------------------------------------------------------------ */

const g = globalThis as unknown as {
  __schedulerJobs?: Map<string, Cron>;
  __schedulerReady?: boolean;
};

/** scheduleId → Cron instance */
const jobs = (g.__schedulerJobs ??= new Map<string, Cron>());

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface ScheduleInput {
  /** ExecutorTask to run when triggered. */
  task: ExecutorTask;
  /** Cron expression for recurring schedules (e.g. "0 9 * * *"). */
  cron?: string;
  /** ISO datetime for one-time execution. Mutually exclusive with cron. */
  runAt?: string;
  /** Session to associate executor Tasks with (for async result tracking). */
  sessionId?: string;
}

export interface ScheduleInfo {
  id: string;
  cron: string | null;
  runAt: Date | null;
  enabled: boolean;
  lastRunAt: Date | null;
  lastTaskId: string | null;
  nextRunAt: Date | null;
  createdAt: Date;
}

/* ------------------------------------------------------------------ */
/*  Schedule lifecycle                                                 */
/* ------------------------------------------------------------------ */

/**
 * Create a new scheduled executor task.
 * Persists to DB and registers an in-memory croner timer.
 */
export async function createSchedule(
  input: ScheduleInput,
): Promise<ScheduleInfo> {
  if (!input.cron && !input.runAt) {
    throw new Error("Either 'cron' or 'runAt' must be provided");
  }
  if (input.cron && input.runAt) {
    throw new Error("'cron' and 'runAt' are mutually exclusive");
  }

  const row = await prisma.scheduledTask.create({
    data: {
      sessionId: input.sessionId ?? null,
      task: input.task as unknown as Prisma.InputJsonValue,
      cron: input.cron ?? null,
      runAt: input.runAt ? new Date(input.runAt) : null,
      enabled: true,
    },
  });

  registerJob(row.id, input.task, {
    cron: row.cron,
    runAt: row.runAt,
    sessionId: row.sessionId,
  });

  return toInfo(row);
}

/**
 * Cancel (disable) a scheduled task. Stops the timer and marks as disabled.
 */
export async function cancelSchedule(
  scheduleId: string,
): Promise<{ found: boolean }> {
  const existing = await prisma.scheduledTask.findUnique({
    where: { id: scheduleId },
  });
  if (!existing) return { found: false };

  // Stop in-memory timer
  const job = jobs.get(scheduleId);
  if (job) {
    job.stop();
    jobs.delete(scheduleId);
  }

  await prisma.scheduledTask.update({
    where: { id: scheduleId },
    data: { enabled: false },
  });

  return { found: true };
}

/**
 * List all scheduled tasks.
 */
export async function listSchedules(): Promise<ScheduleInfo[]> {
  const rows = await prisma.scheduledTask.findMany({
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toInfo);
}

/* ------------------------------------------------------------------ */
/*  Startup recovery                                                   */
/* ------------------------------------------------------------------ */

/**
 * Restore active schedules from DB.
 * Called once at server startup to re-register timers.
 */
export async function restoreSchedules(): Promise<void> {
  if (g.__schedulerReady) return;
  g.__schedulerReady = true;

  const rows = await prisma.scheduledTask.findMany({
    where: { enabled: true },
  });

  for (const row of rows) {
    // Skip one-time schedules whose time has passed
    if (row.runAt && row.runAt <= new Date()) {
      // Already past — run it now if never executed, then disable
      if (!row.lastRunAt) {
        const task = row.task as unknown as ExecutorTask;
        void fireExecutor(row.id, task, row.sessionId);
      }
      await prisma.scheduledTask.update({
        where: { id: row.id },
        data: { enabled: false },
      });
      continue;
    }

    const task = row.task as unknown as ExecutorTask;
    registerJob(row.id, task, {
      cron: row.cron,
      runAt: row.runAt,
      sessionId: row.sessionId,
    });
  }

  console.log(`[scheduler] Restored ${rows.length} schedule(s)`);
}

/* ------------------------------------------------------------------ */
/*  Internal: register croner job                                      */
/* ------------------------------------------------------------------ */

interface JobOpts {
  cron: string | null;
  runAt: Date | null;
  sessionId: string | null;
}

function registerJob(
  scheduleId: string,
  task: ExecutorTask,
  opts: JobOpts,
): void {
  // Stop existing job if re-registering
  const existing = jobs.get(scheduleId);
  if (existing) {
    existing.stop();
    jobs.delete(scheduleId);
  }

  const handler = () => {
    void fireExecutor(scheduleId, task, opts.sessionId);
  };

  let job: Cron;

  if (opts.cron) {
    // Recurring cron schedule
    job = new Cron(opts.cron, handler);
  } else if (opts.runAt) {
    // One-time schedule — croner accepts a Date for single fire
    job = new Cron(opts.runAt, handler);
  } else {
    return; // shouldn't happen — validated at creation
  }

  jobs.set(scheduleId, job);
}

/* ------------------------------------------------------------------ */
/*  Internal: fire executor on trigger                                 */
/* ------------------------------------------------------------------ */

async function fireExecutor(
  scheduleId: string,
  task: ExecutorTask,
  sessionId: string | null,
): Promise<void> {
  try {
    // Create a Task record for tracking
    let taskId: string | null = null;
    if (sessionId) {
      const taskRow = await prisma.task.create({
        data: {
          sessionId,
          type: "executor",
          status: "running",
          input: task as unknown as Prisma.InputJsonValue,
        },
      });
      taskId = taskRow.id;
    }

    const result = await runExecutor(task);

    // Persist result to Task if we have one
    if (taskId) {
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

    // Update schedule metadata
    const updateData: Prisma.ScheduledTaskUpdateInput = {
      lastRunAt: new Date(),
      ...(taskId ? { lastTaskId: taskId } : {}),
    };

    // One-time schedules: auto-disable after execution
    const schedule = await prisma.scheduledTask.findUnique({
      where: { id: scheduleId },
      select: { runAt: true },
    });
    if (schedule?.runAt) {
      updateData.enabled = false;
      const job = jobs.get(scheduleId);
      if (job) {
        job.stop();
        jobs.delete(scheduleId);
      }
    }

    await prisma.scheduledTask.update({
      where: { id: scheduleId },
      data: updateData,
    });

    console.log(
      `[scheduler:${scheduleId}] Executor completed: ${result.status}, ` +
        `${result.toolCallCount} tool calls, ${result.durationMs}ms`,
    );
  } catch (err) {
    console.error(`[scheduler:${scheduleId}] Executor failed:`, err);
  }
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

interface ScheduledTaskRow {
  id: string;
  cron: string | null;
  runAt: Date | null;
  enabled: boolean;
  lastRunAt: Date | null;
  lastTaskId: string | null;
  createdAt: Date;
}

function toInfo(row: ScheduledTaskRow): ScheduleInfo {
  const job = jobs.get(row.id);
  const nextRunAt = job?.nextRun() ?? null;

  return {
    id: row.id,
    cron: row.cron,
    runAt: row.runAt,
    enabled: row.enabled,
    lastRunAt: row.lastRunAt,
    lastTaskId: row.lastTaskId,
    nextRunAt: nextRunAt ? new Date(nextRunAt) : null,
    createdAt: row.createdAt,
  };
}
