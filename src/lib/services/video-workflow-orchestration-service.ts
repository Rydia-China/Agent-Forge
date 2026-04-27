/**
 * Video Workflow Orchestration Service - Workflow coordination and status queries
 * 
 * This service handles:
 * - init_workflow integration (MCP tool calls)
 * - Status queries across resources
 */

import { z } from "zod";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma";
import type { InitWorkflowResult, GetStatusResult } from "@/lib/video/workflow-types";
import { initMcp } from "@/lib/mcp/init";
import { registry } from "@/lib/mcp/registry";

/* ------------------------------------------------------------------ */
/*  init_workflow integration                                          */
/* ------------------------------------------------------------------ */

export async function runInitWorkflow(
  novelId: string,
  scriptDbId: string,
  scriptContent: string,
): Promise<InitWorkflowResult> {
  await initMcp();

  const result = await registry.callTool(
    "novel-video-workflow__init_workflow",
    { novelId, scriptContent, scriptDbId },
  );

  const text = result.content
    ?.map((c: Record<string, unknown>) =>
      "text" in c ? String(c.text) : JSON.stringify(c),
    )
    .join("\n") ?? "";

  const parsed = JSON.parse(text) as InitWorkflowResult;

  // Persist init_result + characters/costumes
  await prisma.novelScript.update({
    where: { id: scriptDbId },
    data: {
      initResult: parsed as unknown as Prisma.InputJsonValue,
      characters: (parsed.characters ?? []) as Prisma.InputJsonValue,
      costumes: (parsed.costumes ?? {}) as Prisma.InputJsonValue,
    },
  });

  return parsed;
}

/**
 * Read the stored init_result for an episode
 */
export async function getInitResult(
  novelId: string,
  scriptKey: string,
): Promise<InitWorkflowResult | null> {
  const script = await prisma.novelScript.findFirst({
    where: { novelId, scriptKey },
    select: { initResult: true },
  });
  if (!script?.initResult) return null;
  return script.initResult as unknown as InitWorkflowResult;
}

/* ------------------------------------------------------------------ */
/*  Status queries                                                     */
/* ------------------------------------------------------------------ */

export const GetStatusParams = z.object({
  scriptId: z.string().min(1).optional(),
  novelId: z.string().min(1).optional(),
  mediaType: z.enum(["video", "image", "json"]).optional(),
  keyPattern: z.string().optional(),
}).refine(
  (d) => d.scriptId || d.novelId,
  { message: "At least one of scriptId or novelId is required" },
);

export type GetStatusInput = z.infer<typeof GetStatusParams>;

export async function getStatus(input: GetStatusInput): Promise<GetStatusResult> {
  let novelId = input.novelId;
  let scriptKey: string | undefined;

  if (input.scriptId) {
    const script = await prisma.novelScript.findUnique({
      where: { id: input.scriptId },
      select: { novelId: true, scriptKey: true },
    });
    if (!script) throw new Error(`Episode not found: ${input.scriptId}`);
    if (!novelId) novelId = script.novelId;
    scriptKey = script.scriptKey;
  }

  if (!novelId) throw new Error("At least one of scriptId or novelId is required");

  const mediaFilter = input.mediaType ? { mediaType: input.mediaType } : {};
  const includeOpts = {
    versions: { orderBy: { version: "asc" as const } },
  };

  const novelResources = await prisma.keyResource.findMany({
    where: { scopeType: "novel", scopeId: novelId, ...mediaFilter },
    include: includeOpts,
    orderBy: { createdAt: "asc" },
  });

  let scriptResources: typeof novelResources = [];
  if (input.scriptId) {
    scriptResources = await prisma.keyResource.findMany({
      where: {
        scopeType: { in: ["script", "session"] },
        scopeId: input.scriptId,
        ...mediaFilter,
      },
      include: includeOpts,
      orderBy: { createdAt: "asc" },
    });
  } else {
    const scripts = await prisma.novelScript.findMany({
      where: { novelId },
      select: { id: true },
    });
    const epIds = scripts.map((s: { id: string }) => s.id);
    if (epIds.length > 0) {
      scriptResources = await prisma.keyResource.findMany({
        where: { scopeType: "script", scopeId: { in: epIds }, ...mediaFilter },
        include: includeOpts,
        orderBy: { createdAt: "asc" },
      });
    }
  }

  const allResources = [...novelResources, ...scriptResources];
  const currentVersionRow = (resource: (typeof allResources)[number]) =>
    resource.versions.find((v: { version: number }) => v.version === resource.currentVersion) ?? null;

  let resources = allResources.map((r) => {
    const currentVer = currentVersionRow(r);
    return {
      key: r.key,
      mediaType: r.mediaType,
      url: currentVer?.url ?? null,
      ...(r.mediaType === "json" ? { data: currentVer?.data ?? null } : {}),
      version: r.currentVersion,
      title: r.title,
      category: r.category,
    };
  });

  if (input.keyPattern) {
    resources = resources.filter((r) => r.key.includes(input.keyPattern!));
  }

  const byCategory = (cat: string) => {
    const items = allResources.filter((r) => r.category === cat);
    return {
      done: items.filter((r) => {
        const currentVer = currentVersionRow(r);
        if (r.mediaType === "json") return r.currentVersion > 0 && currentVer?.data != null;
        return r.currentVersion > 0 && !!currentVer?.url;
      }).length,
      total: items.length,
    };
  };

  const progress = {
    portraits: byCategory("角色立绘"),
    scenes: byCategory("场景"),
    costumes: byCategory("换装"),
    videos: byCategory("视频"),
  };

  const runningTasks: Array<{ id: string; status: string; instruction: string }> = [];

  return {
    identity: {
      novelId,
      ...(input.scriptId ? { scriptId: input.scriptId, scriptKey } : {}),
    },
    resources,
    progress,
    runningTasks,
  };
}
