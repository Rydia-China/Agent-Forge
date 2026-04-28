/**
 * Generation Task Service - Async task management for image generation
 *
 * Handles long-running image generation operations (single and batch)
 * with task submission, background execution, and status polling.
 */

import { z } from "zod";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma";
import * as assetGenerationService from "./video-asset-generation-service";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type TaskType =
  | "portrait"
  | "scene"
  | "costume"
  | "update_portrait"
  | "batch_portraits"
  | "batch_scenes"
  | "batch_costumes";

export type TaskStatus = "pending" | "running" | "completed" | "failed";

export interface TaskResult {
  id: string;
  type: TaskType;
  scopeType: string;
  scopeId: string;
  status: TaskStatus;
  progress: number;
  total: number;
  result?: unknown;
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
}

/* ------------------------------------------------------------------ */
/*  Task submission - Single generation                               */
/* ------------------------------------------------------------------ */

export const SubmitPortraitParams = z.object({
  novelId: z.string().min(1),
  characterName: z.string().min(1),
  styleName: z.string().min(1).optional(),
  prompt: z.string().optional(),
  referenceUrls: z.array(z.string().url()).optional(),
  model: z.string().min(1).optional(),
});

export const SubmitSceneParams = z.object({
  novelId: z.string().min(1),
  sceneName: z.string().min(1),
  mode: z.enum(["single", "grid", "hd"]).default("single"),
  referenceUrls: z.array(z.string().url()).optional(),
  model: z.string().min(1).optional(),
});

export const SubmitCostumeParams = z.object({
  scriptId: z.string().min(1),
  characterName: z.string().min(1),
  styleName: z.string().min(1).optional(),
  referenceUrls: z.array(z.string().url()).optional(),
  model: z.string().min(1).optional(),
});

export const SubmitUpdatePortraitParams = z.object({
  novelId: z.string().min(1),
  characterName: z.string().min(1),
  styleName: z.string().min(1).optional(),
  prompt: z.string().optional(),
  referenceUrls: z.array(z.string().url()).optional(),
  model: z.string().min(1).optional(),
});

/**
 * Submit a portrait generation task
 */
export async function submitPortraitTask(
  input: z.infer<typeof SubmitPortraitParams>,
): Promise<string> {
  const task = await prisma.batchGenerationTask.create({
    data: {
      type: "portrait",
      scopeType: "novel",
      scopeId: input.novelId,
      status: "pending",
      input: input as Prisma.InputJsonValue,
      total: 1,
      progress: 0,
    },
  });

  void executePortraitTask(task.id, input);
  return task.id;
}

/**
 * Submit a scene generation task
 */
export async function submitSceneTask(
  input: z.infer<typeof SubmitSceneParams>,
): Promise<string> {
  const task = await prisma.batchGenerationTask.create({
    data: {
      type: "scene",
      scopeType: "novel",
      scopeId: input.novelId,
      status: "pending",
      input: input as Prisma.InputJsonValue,
      total: 1,
      progress: 0,
    },
  });

  void executeSceneTask(task.id, input);
  return task.id;
}

/**
 * Submit a costume generation task
 */
export async function submitCostumeTask(
  input: z.infer<typeof SubmitCostumeParams>,
): Promise<string> {
  const task = await prisma.batchGenerationTask.create({
    data: {
      type: "costume",
      scopeType: "script",
      scopeId: input.scriptId,
      status: "pending",
      input: input as Prisma.InputJsonValue,
      total: 1,
      progress: 0,
    },
  });

  void executeCostumeTask(task.id, input);
  return task.id;
}

/**
 * Submit an update portrait task
 */
export async function submitUpdatePortraitTask(
  input: z.infer<typeof SubmitUpdatePortraitParams>,
): Promise<string> {
  const task = await prisma.batchGenerationTask.create({
    data: {
      type: "update_portrait",
      scopeType: "novel",
      scopeId: input.novelId,
      status: "pending",
      input: input as Prisma.InputJsonValue,
      total: 1,
      progress: 0,
    },
  });

  void executeUpdatePortraitTask(task.id, input);
  return task.id;
}

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
      type: "batch_portraits",
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
      type: "batch_scenes",
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
      type: "batch_costumes",
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
/*  Task execution - Single generation                                */
/* ------------------------------------------------------------------ */

async function executePortraitTask(
  taskId: string,
  input: z.infer<typeof SubmitPortraitParams>,
): Promise<void> {
  try {
    await prisma.batchGenerationTask.update({
      where: { id: taskId },
      data: { status: "running", startedAt: new Date() },
    });

    const result = await assetGenerationService.generatePortrait(input);

    await prisma.batchGenerationTask.update({
      where: { id: taskId },
      data: {
        status: "completed",
        result: result as unknown as Prisma.InputJsonValue,
        progress: 1,
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

async function executeSceneTask(
  taskId: string,
  input: z.infer<typeof SubmitSceneParams>,
): Promise<void> {
  try {
    await prisma.batchGenerationTask.update({
      where: { id: taskId },
      data: { status: "running", startedAt: new Date() },
    });

    const result = await assetGenerationService.generateScene(input);

    await prisma.batchGenerationTask.update({
      where: { id: taskId },
      data: {
        status: "completed",
        result: result as unknown as Prisma.InputJsonValue,
        progress: 1,
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

async function executeCostumeTask(
  taskId: string,
  input: z.infer<typeof SubmitCostumeParams>,
): Promise<void> {
  try {
    await prisma.batchGenerationTask.update({
      where: { id: taskId },
      data: { status: "running", startedAt: new Date() },
    });

    const result = await assetGenerationService.generateCostume(input);

    await prisma.batchGenerationTask.update({
      where: { id: taskId },
      data: {
        status: "completed",
        result: result as unknown as Prisma.InputJsonValue,
        progress: 1,
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

async function executeUpdatePortraitTask(
  taskId: string,
  input: z.infer<typeof SubmitUpdatePortraitParams>,
): Promise<void> {
  try {
    await prisma.batchGenerationTask.update({
      where: { id: taskId },
      data: { status: "running", startedAt: new Date() },
    });

    const result = await assetGenerationService.updatePortrait(input);

    await prisma.batchGenerationTask.update({
      where: { id: taskId },
      data: {
        status: "completed",
        result: result as unknown as Prisma.InputJsonValue,
        progress: 1,
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
/*  Task execution - Batch generation                                 */
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
        result: result as unknown as Prisma.InputJsonValue,
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
        result: result as unknown as Prisma.InputJsonValue,
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
        result: result as unknown as Prisma.InputJsonValue,
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
export async function getTaskStatus(taskId: string): Promise<TaskResult | null> {
  const task = await prisma.batchGenerationTask.findUnique({
    where: { id: taskId },
  });

  if (!task) return null;

  return {
    id: task.id,
    type: task.type as TaskType,
    scopeType: task.scopeType,
    scopeId: task.scopeId,
    status: task.status as TaskStatus,
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
export async function listTasks(
  scopeType: string,
  scopeId: string,
): Promise<TaskResult[]> {
  const tasks = await prisma.batchGenerationTask.findMany({
    where: { scopeType, scopeId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return tasks.map((task) => ({
    id: task.id,
    type: task.type as TaskType,
    scopeType: task.scopeType,
    scopeId: task.scopeId,
    status: task.status as TaskStatus,
    progress: task.progress,
    total: task.total,
    result: task.result,
    error: task.error ?? undefined,
    startedAt: task.startedAt ?? undefined,
    completedAt: task.completedAt ?? undefined,
    createdAt: task.createdAt,
  }));
}
