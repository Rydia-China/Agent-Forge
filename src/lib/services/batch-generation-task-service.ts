/**
 * Batch Generation Task Service - Async task management for batch image generation
 *
 * Handles long-running batch generation operations (portraits, scenes, costumes)
 * with task submission, background execution, and status polling.
 */

import { z } from "zod";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma";
import * as assetGenerationService from "./video-asset-generation-service";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type BatchTaskType = "portraits" | "scenes" | "costumes";
export type BatchTaskStatus = "pending" | "running" | "completed" | "failed";

export interface BatchTaskResult {
  id: string;
  type: BatchTaskType;
  scopeType: string;
  scopeId: string;
  status: BatchTaskStatus;
  progress: number;
  total: number;
  result?: unknown;
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
}

/* ------------------------------------------------------------------ */
/*  Task submission                                                    */
/* ------------------------------------------------------------------ */

export const SubmitBatchPortraitsParams = z.object({
  novelId: z.string().min(1),
  characterNames: z.array(z.string().min(1)),
  styleName: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
});

export const SubmitBatchScenesParams = z.object({
  novelId: z.string().min(1),
  sceneNames: z.array(z.string().min(1)),
  mode: z.enum(["single", "grid", "hd"]).default("single"),
  model: z.string().min(1).optional(),
});

export const SubmitBatchCostumesParams = z.object({
  scriptId: z.string().min(1),
  characterNames: z.array(z.string().min(1)),
  styleName: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
});

/**
 * Submit a batch portraits generation task
 */
export async function submitBatchPortraitsTask(
  input: z.infer<typeof SubmitBatchPortraitsParams>,
): Promise<string> {
  const task = await prisma.batchGenerationTask.create({
    data: {
      type: "portraits",
      scopeType: "novel",
      scopeId: input.novelId,
      status: "pending",
      input: input as Prisma.InputJsonValue,
      total: input.characterNames.length,
      progress: 0,
    },
  });

  // Start background execution
  void executeBatchPortraitsTask(task.id, input);

  return task.id;
}

/**
 * Submit a batch scenes generation task
 */
export async function submitBatchScenesTask(
  input: z.infer<typeof SubmitBatchScenesParams>,
): Promise<string> {
  const task = await prisma.batchGenerationTask.create({
    data: {
      type: "scenes",
      scopeType: "novel",
      scopeId: input.novelId,
      status: "pending",
      input: input as Prisma.InputJsonValue,
      total: input.sceneNames.length,
      progress: 0,
    },
  });

  // Start background execution
  void executeBatchScenesTask(task.id, input);

  return task.id;
}

/**
 * Submit a batch costumes generation task
 */
export async function submitBatchCostumesTask(
  input: z.infer<typeof SubmitBatchCostumesParams>,
): Promise<string> {
  const task = await prisma.batchGenerationTask.create({
    data: {
      type: "costumes",
      scopeType: "script",
      scopeId: input.scriptId,
      status: "pending",
      input: input as Prisma.InputJsonValue,
      total: input.characterNames.length,
      progress: 0,
    },
  });

  // Start background execution
  void executeBatchCostumesTask(task.id, input);

  return task.id;
}

/* ------------------------------------------------------------------ */
/*  Task execution                                                     */
/* ------------------------------------------------------------------ */

async function executeBatchPortraitsTask(
  taskId: string,
  input: z.infer<typeof SubmitBatchPortraitsParams>,
): Promise<void> {
  try {
    await prisma.batchGenerationTask.update({
      where: { id: taskId },
      data: { status: "running", startedAt: new Date() },
    });

    const result = await assetGenerationService.batchGeneratePortraits(input);

    await prisma.batchGenerationTask.update({
      where: { id: taskId },
      data: {
        status: "completed",
        result: result as Prisma.InputJsonValue,
        progress: input.characterNames.length,
        completedAt: new Date(),
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.batchGenerationTask.update({
      where: { id: taskId },
      data: {
        status: "failed",
        error: message,
        completedAt: new Date(),
      },
    });
  }
}

async function executeBatchScenesTask(
  taskId: string,
  input: z.infer<typeof SubmitBatchScenesParams>,
): Promise<void> {
  try {
    await prisma.batchGenerationTask.update({
      where: { id: taskId },
      data: { status: "running", startedAt: new Date() },
    });

    const result = await assetGenerationService.batchGenerateScenes(input);

    await prisma.batchGenerationTask.update({
      where: { id: taskId },
      data: {
        status: "completed",
        result: result as Prisma.InputJsonValue,
        progress: input.sceneNames.length,
        completedAt: new Date(),
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.batchGenerationTask.update({
      where: { id: taskId },
      data: {
        status: "failed",
        error: message,
        completedAt: new Date(),
      },
    });
  }
}

async function executeBatchCostumesTask(
  taskId: string,
  input: z.infer<typeof SubmitBatchCostumesParams>,
): Promise<void> {
  try {
    await prisma.batchGenerationTask.update({
      where: { id: taskId },
      data: { status: "running", startedAt: new Date() },
    });

    const result = await assetGenerationService.batchGenerateCostumes(input);

    await prisma.batchGenerationTask.update({
      where: { id: taskId },
      data: {
        status: "completed",
        result: result as Prisma.InputJsonValue,
        progress: input.characterNames.length,
        completedAt: new Date(),
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.batchGenerationTask.update({
      where: { id: taskId },
      data: {
        status: "failed",
        error: message,
        completedAt: new Date(),
      },
    });
  }
}

/* ------------------------------------------------------------------ */
/*  Task query                                                         */
/* ------------------------------------------------------------------ */

/**
 * Get task status and result
 */
export async function getBatchTaskStatus(taskId: string): Promise<BatchTaskResult | null> {
  const task = await prisma.batchGenerationTask.findUnique({
    where: { id: taskId },
  });

  if (!task) return null;

  return {
    id: task.id,
    type: task.type as BatchTaskType,
    scopeType: task.scopeType,
    scopeId: task.scopeId,
    status: task.status as BatchTaskStatus,
    progress: task.progress,
    total: task.total,
    result: task.result,
    error: task.error ?? undefined,
    startedAt: task.startedAt ?? undefined,
    completedAt: task.completedAt ?? undefined,
    createdAt: task.createdAt,
  };
}

/**
 * List tasks by scope
 */
export async function listBatchTasks(
  scopeType: string,
  scopeId: string,
): Promise<BatchTaskResult[]> {
  const tasks = await prisma.batchGenerationTask.findMany({
    where: { scopeType, scopeId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return tasks.map((task) => ({
    id: task.id,
    type: task.type as BatchTaskType,
    scopeType: task.scopeType,
    scopeId: task.scopeId,
    status: task.status as BatchTaskStatus,
    progress: task.progress,
    total: task.total,
    result: task.result,
    error: task.error ?? undefined,
    startedAt: task.startedAt ?? undefined,
    completedAt: task.completedAt ?? undefined,
    createdAt: task.createdAt,
  }));
}
