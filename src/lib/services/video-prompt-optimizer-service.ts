import { z } from "zod";
import type { Prisma } from "@/generated/prisma";
import type { ToolContext } from "@/lib/mcp/types";
import type { GetStatusResult } from "@/lib/video/workflow-types";
import * as episodeService from "./episode-service";
import * as orchestrationService from "./video-workflow-orchestration-service";
import * as keyResourceService from "./key-resource-service";
import { setKeyResourceMetadata } from "./video-asset-generation-service";
import { runSubAgentTask } from "./subagent-task-service";

const VIDEO_STANDARD_SKILLS = [
  "video-prompt-optimizer",
  "video-director-playbook",
  "video-seedance-lessons",
  "video-shot-id-policy",
  "video-character-dna",
] as const;

const PromptSchema = z.object({
  key: z.string().min(1),
  title: z.string().min(1),
  prompt: z.string().min(1),
  definition: z.string().min(1),
  duration: z.number().min(1).max(60),
  refUrls: z.array(z.string().url()),
});

const ReviewSchema = z.object({
  passed: z.boolean(),
  allowVideoGeneration: z.boolean(),
  issues: z.array(z.unknown()),
  suggestions: z.array(z.string()),
  summary: z.string(),
});

const OptimizerOutputSchema = z.object({
  status: z.enum(["passed", "max_iterations", "conflict", "failed"]),
  iterationCount: z.number(),
  finalPrompts: z.array(PromptSchema),
  finalReview: ReviewSchema,
  iterationHistory: z.array(z.unknown()),
  resolvedIssues: z.array(z.unknown()),
  remainingIssues: z.array(z.unknown()),
  newIssues: z.array(z.unknown()),
  doNotRegress: z.array(z.string()),
  bestVersion: z.unknown(),
  conflict: z.unknown().nullable(),
  summary: z.string(),
});

const optimizerOutputSchemaForSubAgent = {
  type: "object",
  properties: {
    status: { type: "string", enum: ["passed", "max_iterations", "conflict", "failed"] },
    iterationCount: { type: "number" },
    finalPrompts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          key: { type: "string" },
          title: { type: "string" },
          prompt: { type: "string" },
          definition: { type: "string" },
          duration: { type: "number" },
          refUrls: { type: "array", items: { type: "string" } },
        },
        required: ["key", "title", "prompt", "definition", "duration", "refUrls"],
      },
    },
    finalReview: {
      type: "object",
      properties: {
        passed: { type: "boolean" },
        allowVideoGeneration: { type: "boolean" },
        issues: { type: "array" },
        suggestions: { type: "array", items: { type: "string" } },
        summary: { type: "string" },
      },
      required: ["passed", "allowVideoGeneration", "issues", "suggestions", "summary"],
    },
    iterationHistory: { type: "array" },
    resolvedIssues: { type: "array" },
    remainingIssues: { type: "array" },
    newIssues: { type: "array" },
    doNotRegress: { type: "array", items: { type: "string" } },
    bestVersion: { type: "object" },
    conflict: { type: ["object", "null"] },
    summary: { type: "string" },
  },
  required: [
    "status",
    "iterationCount",
    "finalPrompts",
    "finalReview",
    "iterationHistory",
    "resolvedIssues",
    "remainingIssues",
    "newIssues",
    "doNotRegress",
    "bestVersion",
    "conflict",
    "summary",
  ],
};

export const OptimizeVideoPromptsParams = z.object({
  scriptId: z.string().min(1),
  savePrompts: z.boolean().optional().default(true),
  stopBeforeVideoGeneration: z.boolean().optional().default(true),
  model: z.string().optional(),
});

export type OptimizeVideoPromptsInput = z.infer<typeof OptimizeVideoPromptsParams>;

interface SavedPrompt {
  key: string;
  keyResourceId: string;
  version: number;
}

export interface OptimizeVideoPromptsResult {
  status: "passed" | "max_iterations" | "conflict" | "failed";
  scriptId: string;
  scriptKey: string;
  optimizerTaskId?: string;
  optimizerAgentId: string;
  iterationCount: number;
  promptCount: number;
  savedPrompts: SavedPrompt[];
  remainingIssues: unknown[];
  summary: string;
}

function jsonBlock(value: unknown): string {
  return `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
}

function textBlock(value: string | null): string {
  return `\`\`\`text\n${value ?? ""}\n\`\`\``;
}

function resourceSummary(status: GetStatusResult): Array<{
  key: string;
  title: string | null;
  category: string | null;
  mediaType: string;
  url: string | null;
  refUrls: string[];
}> {
  return status.resources
    .filter((resource) => resource.mediaType === "image")
    .map((resource) => ({
      key: resource.key,
      title: resource.title,
      category: resource.category,
      mediaType: resource.mediaType,
      url: resource.url,
      refUrls: resource.refUrls,
    }));
}

function buildOptimizerInstruction(input: {
  scriptId: string;
  scriptKey: string;
  episode: { scriptKey: string; initResult: unknown };
  episodeWindow: Awaited<ReturnType<typeof episodeService.getEpisodeWindow>>;
  status: GetStatusResult;
  stopBeforeVideoGeneration: boolean;
}): string {
  const lines: string[] = [
    "你是 Prompt Optimizer。你的任务是为指定 EP 进行增量迭代式的视频 prompt 生成和审查。",
    "",
    "## 调度边界",
    "- 只处理下方 canonical scriptId 对应的当前 EP。",
    "- 下方 episodeWindow、episodeInitResult、resourceStatus 是服务端按 scriptId 读取的原始数据；不得转述、改写、替换或凭记忆补全。",
    "- 你可以调度 Prompt Writer / Reviewer subagent，但传给它们的 EP 内容必须逐字来自下方原始数据块。",
    "- 不允许使用其他小说、其他 EP、示例 EP、历史 EP 或你记忆中的 James/Kennedy/墓园等内容替换当前数据。",
    "- 不调用 video_workflow 工具；保存和视频生成由外层服务端处理。",
    "",
    "## 当前任务",
    `scriptId: ${input.scriptId}`,
    `scriptKey: ${input.scriptKey}`,
    `stopBeforeVideoGeneration: ${input.stopBeforeVideoGeneration}`,
    "最多 5 轮增量迭代。Reviewer 通过后返回 status=\"passed\"；不要自行保存 prompt，不要生成视频。",
    "",
    "## Canonical Episode Init Result",
    jsonBlock(input.episode.initResult),
    "",
    "## Canonical Episode Source Window",
  ];

  for (const episode of input.episodeWindow) {
    lines.push("");
    lines.push(`### ${episode.relation.toUpperCase()} ${episode.scriptKey}`);
    lines.push(`scriptId: ${episode.scriptId}`);
    if (episode.scriptName) lines.push(`scriptName: ${episode.scriptName}`);
    lines.push("scriptContent 原文:");
    lines.push(textBlock(episode.scriptContent));
    lines.push("initResult 原始 JSON:");
    lines.push(jsonBlock(episode.initResult));
  }

  lines.push("");
  lines.push("## Canonical Resource Status");
  lines.push(jsonBlock({
    identity: input.status.identity,
    progress: input.status.progress,
    imageResources: resourceSummary(input.status),
  }));
  lines.push("");
  lines.push("## 输出格式");
  lines.push("只返回纯 JSON 对象，字段必须包含：status, iterationCount, finalPrompts, finalReview, iterationHistory, resolvedIssues, remainingIssues, newIssues, doNotRegress, bestVersion, conflict, summary。");

  return lines.join("\n");
}

function parseOptimizerOutput(output: string): z.infer<typeof OptimizerOutputSchema> {
  const trimmed = output.trim();
  const withoutFence = trimmed
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "");
  return OptimizerOutputSchema.parse(JSON.parse(withoutFence));
}

function toPromptData(
  optimizerOutput: z.infer<typeof OptimizerOutputSchema>,
): Prisma.InputJsonObject {
  return {
    iterationCount: optimizerOutput.iterationCount,
    iterationHistory: optimizerOutput.iterationHistory as Prisma.InputJsonArray,
    bestVersion: optimizerOutput.bestVersion as Prisma.InputJsonValue,
    resolvedIssues: optimizerOutput.resolvedIssues as Prisma.InputJsonArray,
    remainingIssues: optimizerOutput.remainingIssues as Prisma.InputJsonArray,
    newIssues: optimizerOutput.newIssues as Prisma.InputJsonArray,
    doNotRegress: optimizerOutput.doNotRegress,
    optimizerSummary: optimizerOutput.summary,
  };
}

export async function assertReferenceUrlsBelongToScript(
  scriptId: string,
  refUrls: string[] | undefined,
): Promise<void> {
  if (!refUrls?.length) return;
  const status = await orchestrationService.getStatus({ scriptId });
  const allowedUrls = new Set<string>();
  for (const resource of status.resources) {
    if (resource.mediaType !== "image") continue;
    if (resource.url) allowedUrls.add(resource.url);
    for (const refUrl of resource.refUrls) allowedUrls.add(refUrl);
  }
  const invalidUrls = refUrls.filter((url) => !allowedUrls.has(url));
  if (invalidUrls.length > 0) {
    throw new Error(
      `RefUrls do not belong to current script resources: ${invalidUrls.join(", ")}`,
    );
  }
}

export async function optimizeVideoPrompts(
  input: OptimizeVideoPromptsInput,
  context?: ToolContext,
): Promise<OptimizeVideoPromptsResult> {
  const episode = await episodeService.getEpisode(input.scriptId);
  if (!episode) throw new Error(`Episode not found: ${input.scriptId}`);
  if (!episode.initResult) throw new Error(`Episode ${input.scriptId} has no init_result data`);

  const episodeWindow = await episodeService.getEpisodeWindow(input.scriptId);
  const currentWindow = episodeWindow.find((item) => item.relation === "current");
  if (!currentWindow) throw new Error(`Episode window missing current script: ${input.scriptId}`);

  const status = await orchestrationService.getStatus({ scriptId: input.scriptId });
  if (status.progress.costumes.done < status.progress.costumes.total) {
    throw new Error(
      `Costume gate not complete: ${status.progress.costumes.done}/${status.progress.costumes.total}`,
    );
  }

  const instruction = buildOptimizerInstruction({
    scriptId: input.scriptId,
    scriptKey: episode.scriptKey,
    episode,
    episodeWindow,
    status,
    stopBeforeVideoGeneration: input.stopBeforeVideoGeneration,
  });

  const result = await runSubAgentTask({
    instruction,
    mcpScope: ["subagent"],
    skills: [...VIDEO_STANDARD_SKILLS],
    outputSchema: optimizerOutputSchemaForSubAgent,
    maxIterations: 50,
    maxRetries: 2,
    includeTrace: true,
    ...(input.model ? { model: input.model } : {}),
  }, context);

  const optimizerOutput = parseOptimizerOutput(result.output);
  const savedPrompts: SavedPrompt[] = [];

  if (input.savePrompts && optimizerOutput.status === "passed" && optimizerOutput.finalReview.passed) {
    const promptData = toPromptData(optimizerOutput);
    for (const prompt of optimizerOutput.finalPrompts) {
      await assertReferenceUrlsBelongToScript(input.scriptId, prompt.refUrls);
      const resource = await keyResourceService.upsertResource(
        "script",
        input.scriptId,
        prompt.key,
        "json",
        {
          title: prompt.title,
          prompt: prompt.prompt,
          refUrls: prompt.refUrls,
          data: {
            definition: prompt.definition,
            duration: prompt.duration,
            reviewResult: optimizerOutput.finalReview as Prisma.InputJsonValue,
            data: promptData,
          } as Prisma.InputJsonValue,
        },
      );
      await setKeyResourceMetadata(resource.id, "视频Prompt", prompt.title);
      savedPrompts.push({
        key: prompt.key,
        keyResourceId: resource.id,
        version: resource.version,
      });
    }
  }

  return {
    status: optimizerOutput.status,
    scriptId: input.scriptId,
    scriptKey: episode.scriptKey,
    optimizerTaskId: result.taskId,
    optimizerAgentId: result.agentId,
    iterationCount: optimizerOutput.iterationCount,
    promptCount: optimizerOutput.finalPrompts.length,
    savedPrompts,
    remainingIssues: optimizerOutput.remainingIssues,
    summary: optimizerOutput.summary,
  };
}
