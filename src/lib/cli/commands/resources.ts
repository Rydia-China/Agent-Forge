import { z } from "zod";
import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/db";
import { registry } from "../registry";

const BackfillVideoPromptDataParams = z.object({
  scriptId: z.string().min(1).optional(),
  dryRun: z.boolean().optional().default(false),
});

function isPlainJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergePromptFieldsIntoData(
  data: unknown,
  prompt: string | null,
  refUrls: string[],
): Prisma.InputJsonValue | null {
  if (data == null && prompt == null && refUrls.length === 0) return null;
  const cloned = data == null ? {} : JSON.parse(JSON.stringify(data));
  if (!isPlainJsonObject(cloned)) return cloned as Prisma.InputJsonValue;
  return {
    ...cloned,
    ...(prompt != null ? { prompt } : {}),
    refUrls,
  } as Prisma.InputJsonValue;
}

registry.register({
  name: "resources:backfill-video-prompts",
  description: "Backfill reviewed video prompt JSON data with prompt/refUrls from current versions",
  schema: BackfillVideoPromptDataParams,
  handler: async (args) => {
    const params = args as z.infer<typeof BackfillVideoPromptDataParams>;
    const resources = await prisma.keyResource.findMany({
      where: {
        category: "视频Prompt",
        ...(params.scriptId ? { scopeType: "script", scopeId: params.scriptId } : {}),
      },
      include: { versions: { orderBy: { version: "asc" } } },
      orderBy: { createdAt: "asc" },
    });

    const results = [];
    for (const resource of resources) {
      const version = resource.versions.find((item) => item.version === resource.currentVersion);
      if (!version) {
        results.push({
          key: resource.key,
          status: "skipped",
          reason: "current version not found",
        });
        continue;
      }

      const nextData = mergePromptFieldsIntoData(version.data, version.prompt, version.refUrls ?? []);
      const changed = JSON.stringify(nextData) !== JSON.stringify(version.data);
      if (changed && !params.dryRun) {
        await prisma.keyResourceVersion.update({
          where: { id: version.id },
          data: { data: nextData ?? undefined },
        });
      }

      results.push({
        key: resource.key,
        keyResourceId: resource.id,
        version: version.version,
        hasPrompt: typeof version.prompt === "string" && version.prompt.length > 0,
        refUrlCount: version.refUrls?.length ?? 0,
        changed,
      });
    }

    console.log(JSON.stringify({
      dryRun: params.dryRun,
      scriptId: params.scriptId ?? null,
      total: results.length,
      changed: results.filter((item) => item.changed).length,
      results,
    }, null, 2));
  },
});
