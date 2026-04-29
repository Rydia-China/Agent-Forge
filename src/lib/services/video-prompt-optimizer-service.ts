import { z } from "zod";
import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/db";
import type { ToolContext } from "@/lib/mcp/types";
import type { GetStatusResult } from "@/lib/video/workflow-types";
import * as episodeService from "./episode-service";
import * as orchestrationService from "./video-workflow-orchestration-service";
import * as keyResourceService from "./key-resource-service";
import { setKeyResourceMetadata } from "./video-asset-generation-service";
import { runSubAgentTask } from "./subagent-task-service";

const VIDEO_STANDARD_SKILLS = [
  "video-director-playbook",
  "video-seedance-lessons",
  "video-shot-id-policy",
  "video-character-dna",
] as const;

const WRITER_SKILLS = [
  "video-prompt-writer",
  "video-skill-reviewer",
  ...VIDEO_STANDARD_SKILLS,
] as const;

const REVIEWER_SKILLS = [
  "video-skill-reviewer",
  "video-prompt-writer",
  ...VIDEO_STANDARD_SKILLS,
] as const;

const PROMPT_WRITER_MODEL = "anthropic/claude-opus-4.6";
const PROMPT_REVIEWER_MODEL = "anthropic/claude-opus-4.7";

const PromptSchema = z.object({
  key: z.string().min(1),
  title: z.string().min(1),
  shot_function: z.string().min(1),
  prev_shot_recap: z.string().min(1),
  next_shot_setup: z.string().min(1),
  prompt: z.string().min(1),
  definition: z.string().min(1),
  duration: z.number().min(1).max(60),
  refUrls: z.array(z.string().url()),
});

const RawPromptSchema = z.object({
  key: z.string(),
  title: z.string(),
  shot_function: z.string(),
  prev_shot_recap: z.string(),
  next_shot_setup: z.string(),
  prompt: z.string(),
  definition: z.string(),
  duration: z.number(),
  refUrls: z.array(z.string()),
});

const ReviewSchema = z.object({
  passed: z.boolean(),
  allowVideoGeneration: z.boolean(),
  issues: z.array(z.unknown()),
  suggestions: z.array(z.string()),
  summary: z.string(),
});

const WriterOutputSchema = z.object({
  prompts: z.array(PromptSchema),
  summary: z.string(),
});

const RawWriterOutputSchema = WriterOutputSchema.extend({
  prompts: z.array(RawPromptSchema),
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

const writerOutputSchemaForSubAgent = {
  type: "object",
  properties: {
    prompts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          key: { type: "string" },
          title: { type: "string" },
          shot_function: { type: "string" },
          prev_shot_recap: { type: "string" },
          next_shot_setup: { type: "string" },
          prompt: { type: "string" },
          definition: { type: "string" },
          duration: { type: "number" },
          refUrls: { type: "array", items: { type: "string" } },
        },
        required: [
          "key",
          "title",
          "shot_function",
          "prev_shot_recap",
          "next_shot_setup",
          "prompt",
          "definition",
          "duration",
          "refUrls",
        ],
      },
    },
    summary: { type: "string" },
  },
  required: ["prompts", "summary"],
};

const reviewOutputSchemaForSubAgent = {
  type: "object",
  properties: {
    passed: { type: "boolean" },
    allowVideoGeneration: { type: "boolean" },
    issues: { type: "array" },
    suggestions: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
  },
  required: ["passed", "allowVideoGeneration", "issues", "suggestions", "summary"],
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

function buildCanonicalContextPackage(input: {
  scriptId: string;
  scriptKey: string;
  episode: { scriptKey: string; initResult: unknown };
  episodeWindow: Awaited<ReturnType<typeof episodeService.getEpisodeWindow>>;
  status: GetStatusResult;
  stopBeforeVideoGeneration: boolean;
}): string {
  const lines: string[] = [
    "以下是服务端为视频 prompt pipeline 准备的 canonical context package。",
    "",
    "## 数据边界",
    "- 只处理下方 canonical scriptId 对应的当前 EP。",
    "- 下方 episodeWindow、episodeInitResult、resourceStatus 是服务端按 scriptId 读取的原始数据；不得转述、改写、替换或凭记忆补全。",
    "- 不允许使用其他小说、其他 EP、示例 EP、历史 EP 或你记忆中的 James/Kennedy/墓园等内容替换当前数据。",
    "",
    "## 当前任务",
    `scriptId: ${input.scriptId}`,
    `scriptKey: ${input.scriptKey}`,
    `stopBeforeVideoGeneration: ${input.stopBeforeVideoGeneration}`,
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

  return lines.join("\n");
}

function parseJsonOutput<T>(schema: z.ZodType<T>, output: string): T {
  const trimmed = output.trim();
  const withoutFence = trimmed
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "");
  return schema.parse(JSON.parse(withoutFence));
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

async function deleteStaleReviewedPromptResources(
  scriptId: string,
  currentPromptKeys: string[],
): Promise<void> {
  await prisma.keyResource.deleteMany({
    where: {
      scopeType: "script",
      scopeId: scriptId,
      mediaType: "json",
      category: "视频Prompt",
      key: { notIn: currentPromptKeys },
    },
  });
}

type Prompt = z.infer<typeof PromptSchema>;
type RawPrompt = z.infer<typeof RawPromptSchema>;
type Review = z.infer<typeof ReviewSchema>;
type WriterOutput = z.infer<typeof WriterOutputSchema>;
type RawWriterOutput = z.infer<typeof RawWriterOutputSchema>;
type OptimizerOutput = z.infer<typeof OptimizerOutputSchema>;

interface PromptBrief {
  key: string;
  title: string;
  shot_function: string;
  prev_shot_recap: string;
  next_shot_setup: string;
  definition: string;
  duration: number;
  refUrlCount: number;
  promptPreview: string;
}

interface IssueBrief {
  issueId?: string;
  rule?: string;
  key?: string;
  blocking?: boolean;
  severity?: string;
  description: string;
  suggestion?: string;
}

interface IterationBrief {
  iteration: number;
  promptCount: number;
  passed: boolean;
  allowVideoGeneration: boolean;
  issueCount: number;
  blockingIssueCount: number;
  writerSummary: string;
  reviewerSummary: string;
  issueIds: string[];
}

interface PromptRefUrlValidation {
  prompts: Prompt[];
  issues: unknown[];
  suggestions: string[];
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("Video prompt optimization cancelled");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function booleanField(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  return typeof value === "boolean" ? value : undefined;
}

function summarizePrompts(prompts: Prompt[]): PromptBrief[] {
  return prompts.map((prompt) => ({
    key: prompt.key,
    title: prompt.title,
    shot_function: prompt.shot_function,
    prev_shot_recap: prompt.prev_shot_recap,
    next_shot_setup: prompt.next_shot_setup,
    definition: prompt.definition,
    duration: prompt.duration,
    refUrlCount: prompt.refUrls.length,
    promptPreview: prompt.prompt.slice(0, 1200),
  }));
}

function summarizeIssue(issue: unknown): IssueBrief {
  if (!isRecord(issue)) {
    return { description: String(issue) };
  }

  const issueId = stringField(issue, "issueId");
  const rule = stringField(issue, "rule");
  const key = stringField(issue, "key");
  const blocking = booleanField(issue, "blocking");
  const severity = stringField(issue, "severity");
  const suggestion = stringField(issue, "suggestion");
  const description =
    stringField(issue, "description") ??
    stringField(issue, "message") ??
    stringField(issue, "summary") ??
    JSON.stringify(issue);

  return {
    ...(issueId ? { issueId } : {}),
    ...(rule ? { rule } : {}),
    ...(key ? { key } : {}),
    ...(blocking !== undefined ? { blocking } : {}),
    ...(severity ? { severity } : {}),
    description,
    ...(suggestion ? { suggestion } : {}),
  };
}

function isBlockingIssue(issue: unknown): boolean {
  if (!isRecord(issue)) return false;
  const blocking = booleanField(issue, "blocking");
  if (blocking !== undefined) return blocking;
  const severity = stringField(issue, "severity")?.toLowerCase();
  return severity === "blocking" || severity === "critical" || severity === "p0";
}

function summarizeIssues(issues: unknown[], blockingOnly: boolean): IssueBrief[] {
  return issues
    .filter((issue) => !blockingOnly || isBlockingIssue(issue))
    .map(summarizeIssue)
    .slice(0, 24);
}

function issueIdentity(issue: unknown): string {
  if (!isRecord(issue)) return String(issue).slice(0, 160);
  return (
    stringField(issue, "issueId") ??
    stringField(issue, "rule") ??
    stringField(issue, "description") ??
    JSON.stringify(issue)
  ).slice(0, 160);
}

function mergeDoNotRegress(existing: string[], suggestions: string[]): string[] {
  const normalized = [...existing, ...suggestions]
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .map((item) => item.slice(0, 240));
  return Array.from(new Set(normalized)).slice(-20);
}

function allowedImageUrls(status: GetStatusResult): Set<string> {
  const urls = new Set<string>();
  for (const resource of status.resources) {
    if (resource.mediaType !== "image") continue;
    if (resource.url) urls.add(resource.url);
    for (const refUrl of resource.refUrls) urls.add(refUrl);
  }
  return urls;
}

function isValidAbsoluteUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function validateWriterRefUrls(
  output: RawWriterOutput,
  allowedUrls: Set<string>,
): PromptRefUrlValidation {
  const issues: unknown[] = [];
  const suggestions: string[] = [];
  const prompts = output.prompts.map((prompt, promptIndex) => {
    const key = prompt.key.trim() || `invalid_prompt_${promptIndex + 1}`;
    const title = prompt.title.trim() || key;
    const shotFunction = prompt.shot_function.trim() || "INVALID: missing shot_function";
    const prevShotRecap = prompt.prev_shot_recap.trim() || "INVALID: missing prev_shot_recap";
    const nextShotSetup = prompt.next_shot_setup.trim() || "INVALID: missing next_shot_setup";
    const promptText = prompt.prompt.trim() || "INVALID: missing prompt";
    const definition = prompt.definition.trim() || "INVALID: missing definition";
    const duration = Number.isFinite(prompt.duration) && prompt.duration >= 1 && prompt.duration <= 60
      ? prompt.duration
      : 5;
    const validRefUrls: string[] = [];

    if (prompt.key.trim().length === 0) {
      issues.push({
        issueId: `PROMPT_KEY_EMPTY_${promptIndex}`,
        rule: "prompt.key.required",
        key,
        blocking: true,
        severity: "p0",
        description: `prompts[${promptIndex}].key is empty.`,
        suggestion: "Every prompt item must have a stable non-empty key.",
      });
      suggestions.push(`Set a stable non-empty key for prompts[${promptIndex}].`);
    }

    if (prompt.title.trim().length === 0) {
      issues.push({
        issueId: `PROMPT_TITLE_EMPTY_${key}`,
        rule: "prompt.title.required",
        key,
        blocking: true,
        severity: "p0",
        description: `${key}.title is empty.`,
        suggestion: "Every prompt item must have a non-empty human-readable title.",
      });
      suggestions.push(`Set a non-empty title for ${key}.`);
    }

    if (prompt.prompt.trim().length === 0) {
      issues.push({
        issueId: `PROMPT_BODY_EMPTY_${key}`,
        rule: "prompt.prompt.required",
        key,
        blocking: true,
        severity: "p0",
        description: `${key}.prompt is empty.`,
        suggestion: "Every prompt item must include the full video prompt text.",
      });
      suggestions.push(`Write the full video prompt text for ${key}.`);
    }

    if (prompt.definition.trim().length === 0) {
      issues.push({
        issueId: `PROMPT_DEFINITION_EMPTY_${key}`,
        rule: "prompt.definition.required",
        key,
        blocking: true,
        severity: "p0",
        description: `${key}.definition is empty.`,
        suggestion: "Every prompt item must include a definition mapping @图 references to exact Canonical Resource Status URLs.",
      });
      suggestions.push(`Fill ${key}.definition with exact @图 reference mappings and URLs.`);
    }

    if (duration !== prompt.duration) {
      issues.push({
        issueId: `PROMPT_DURATION_INVALID_${key}`,
        rule: "prompt.duration.range",
        key,
        blocking: true,
        severity: "p0",
        description: `${key}.duration must be a number from 1 to 60; got ${prompt.duration}.`,
        suggestion: "Set duration to the actual clip duration in seconds, within 1-60.",
      });
      suggestions.push(`Set ${key}.duration to a valid number from 1 to 60.`);
    }

    for (const [index, refUrl] of prompt.refUrls.entries()) {
      if (!isValidAbsoluteUrl(refUrl)) {
        issues.push({
          issueId: `REF_URL_INVALID_FORMAT_${key}_${index}`,
          rule: "refUrls.must_be_canonical_resource_url",
          key,
          blocking: true,
          severity: "p0",
          description: `refUrls[${index}] is not an absolute URL: ${refUrl}`,
          suggestion: "refUrls must contain only exact image URLs from Canonical Resource Status. Do not put previous-frame placeholders or local file paths in refUrls; the video generation service injects previous clip/frame references later.",
        });
        suggestions.push(
          `For ${key}, replace refUrls[${index}] with an exact URL from Canonical Resource Status or remove it if it is a previous-frame placeholder.`,
        );
        continue;
      }

      if (!allowedUrls.has(refUrl)) {
        issues.push({
          issueId: `REF_URL_NOT_CANONICAL_${key}_${index}`,
          rule: "refUrls.must_belong_to_current_script_resources",
          key,
          blocking: true,
          severity: "p0",
          description: `refUrls[${index}] is not present in Canonical Resource Status: ${refUrl}`,
          suggestion: "Use only exact image URLs listed in Canonical Resource Status for the current EP. Do not invent URLs and do not reference generated previous-frame assets in prompt JSON.",
        });
        suggestions.push(
          `For ${key}, use only Canonical Resource Status image URLs; do not invent or carry non-canonical refUrls.`,
        );
        continue;
      }

      validRefUrls.push(refUrl);
    }

    return PromptSchema.parse({
      ...prompt,
      key,
      title,
      shot_function: shotFunction,
      prev_shot_recap: prevShotRecap,
      next_shot_setup: nextShotSetup,
      prompt: promptText,
      definition,
      duration,
      refUrls: validRefUrls,
    });
  });

  return {
    prompts,
    issues,
    suggestions: Array.from(new Set(suggestions)),
  };
}

function buildSyntheticRefUrlReview(validation: PromptRefUrlValidation): Review {
  return ReviewSchema.parse({
    passed: false,
    allowVideoGeneration: false,
    issues: validation.issues,
    suggestions: validation.suggestions,
    summary: "Writer output contained invalid refUrls. The next iteration must use only exact current-EP image URLs from Canonical Resource Status; previous clip/frame references are injected later by the video generation service, not by prompt JSON.",
  });
}

function buildWriterInstruction(input: {
  canonicalContext: string;
  iteration: number;
  previousPromptBriefs: PromptBrief[] | null;
  latestReviewSummary: string | null;
  blockingIssues: IssueBrief[];
  iterationBriefs: IterationBrief[];
  doNotRegress: string[];
}): string {
  const lines: string[] = [
    "你是 Prompt Writer。只负责为当前 EP 生成或修订视频提示词。",
    "",
    "## 不可违反的边界",
    "- 只使用下方 canonical 原始数据块；不得凭记忆补全、替换或转述为其他 EP。",
    "- 不执行文件操作，不调用工具，不保存 prompt，不生成视频。",
    "- `refUrls` 只能填写 Canonical Resource Status 中逐字列出的图片 URL；不得填写本地路径、占位符、上一段尾帧、压缩图文件名或你推测出来的 URL。",
    "- 连续 clip 的前段视频/最后一帧参照由视频生成服务层自动注入，不属于 prompt JSON 的 `refUrls`。",
    "- 服务端会持久化完整 latestPromptJson、latestReviewJson、iterationHistory 和 doNotRegress；你本轮只会收到必要的增量修订包。",
    "- 如果这是第 2-5 轮，必须基于 Revision Packet 做增量修订，不得回退已解决内容。",
    "- 只返回纯 JSON 对象，字段必须是 prompts 和 summary。",
    "- prompts 每一项必须包含顶层字段：key, title, shot_function, prev_shot_recap, next_shot_setup, prompt, definition, duration, refUrls。",
    "",
    `## Iteration ${input.iteration}`,
    "",
    "## Canonical Context",
    input.canonicalContext,
  ];

  if (input.previousPromptBriefs) {
    lines.push("");
    lines.push("## Revision Packet: previousPromptBriefs");
    lines.push(jsonBlock(input.previousPromptBriefs));
  }
  if (input.latestReviewSummary) {
    lines.push("");
    lines.push("## Revision Packet: latestReviewSummary");
    lines.push(textBlock(input.latestReviewSummary));
  }
  if (input.blockingIssues.length > 0) {
    lines.push("");
    lines.push("## Revision Packet: blockingIssuesToFix");
    lines.push(jsonBlock(input.blockingIssues));
  }
  if (input.iterationBriefs.length > 0) {
    lines.push("");
    lines.push("## Revision Packet: iterationBriefs");
    lines.push(jsonBlock(input.iterationBriefs));
  }
  if (input.doNotRegress.length > 0) {
    lines.push("");
    lines.push("## Revision Packet: doNotRegress");
    lines.push(jsonBlock(input.doNotRegress));
  }

  lines.push("");
  lines.push("FINAL OUTPUT CONSTRAINT: return ONLY the JSON object. The first character must be `{` and the last character must be `}`. Do not include analysis, plan, recap, markdown, or prose outside JSON.");

  return lines.join("\n");
}

function buildReviewerInstruction(input: {
  canonicalContext: string;
  iteration: number;
  prompts: Prompt[];
  iterationBriefs: IterationBrief[];
  doNotRegress: string[];
}): string {
  const lines: string[] = [
    "你是 Prompt Reviewer。只负责审查当前 EP 的 Writer 输出是否满足全部视频 prompt 标准。",
    "",
    "## 不可违反的边界",
    "- 只审查下方 canonical 原始数据块和 promptJson；不得自行改写 prompt。",
    "- 不执行文件操作，不调用工具，不保存 prompt，不生成视频。",
    "- `refUrls` 只能包含 Canonical Resource Status 中逐字列出的图片 URL；上一段尾帧、15s 视频参照、压缩图和 _end.png/_spatial.png 等生成期承接资源由视频生成服务层注入，不属于 prompt JSON。",
    "- 不得因为 prompt JSON 缺少生成期承接资源而判 blocking；只能审查 prompt 文本是否明确写出连续镜头的站位/姿态/构图承接关系。",
    "- 必须使用稳定 issueId / rule / blocking 描述问题，便于下一轮 Writer 精确修复。",
    "- 只有全部阻塞问题解决时，passed 和 allowVideoGeneration 才能同时为 true。",
    "- 只返回纯 JSON 对象，字段必须是 passed, allowVideoGeneration, issues, suggestions, summary。",
    "",
    `## Iteration ${input.iteration}`,
    "",
    "## Canonical Context",
    input.canonicalContext,
    "",
    "## promptJson",
    jsonBlock(input.prompts),
  ];

  if (input.iterationBriefs.length > 0) {
    lines.push("");
    lines.push("## Prior Iteration Briefs");
    lines.push(jsonBlock(input.iterationBriefs));
  }
  if (input.doNotRegress.length > 0) {
    lines.push("");
    lines.push("## doNotRegress");
    lines.push(jsonBlock(input.doNotRegress));
  }

  return lines.join("\n");
}

function issueCount(review: Review): number {
  return review.issues.length;
}

function buildOptimizerOutput(input: {
  status: OptimizerOutput["status"];
  iterationCount: number;
  finalPrompts: Prompt[];
  finalReview: Review;
  iterationHistory: unknown[];
  resolvedIssues: unknown[];
  remainingIssues: unknown[];
  newIssues: unknown[];
  doNotRegress: string[];
  bestVersion: unknown;
  summary: string;
}): OptimizerOutput {
  return OptimizerOutputSchema.parse({
    status: input.status,
    iterationCount: input.iterationCount,
    finalPrompts: input.finalPrompts,
    finalReview: input.finalReview,
    iterationHistory: input.iterationHistory,
    resolvedIssues: input.resolvedIssues,
    remainingIssues: input.remainingIssues,
    newIssues: input.newIssues,
    doNotRegress: input.doNotRegress,
    bestVersion: input.bestVersion,
    conflict: null,
    summary: input.summary,
  });
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

  const canonicalContext = buildCanonicalContextPackage({
    scriptId: input.scriptId,
    scriptKey: episode.scriptKey,
    episode,
    episodeWindow,
    status,
    stopBeforeVideoGeneration: input.stopBeforeVideoGeneration,
  });

  const iterationHistory: unknown[] = [];
  const iterationBriefs: IterationBrief[] = [];
  const resolvedIssues: unknown[] = [];
  let remainingIssues: unknown[] = [];
  let newIssues: unknown[] = [];
  let doNotRegress: string[] = [];
  let latestPrompts: Prompt[] | null = null;
  let latestReview: Review | null = null;
  let finalPrompts: Prompt[] = [];
  let finalReview: Review = {
    passed: false,
    allowVideoGeneration: false,
    issues: [],
    suggestions: [],
    summary: "Reviewer has not run.",
  };
  let bestVersion: unknown = {
    iteration: 0,
    prompts: [],
    reason: "No prompts generated yet.",
  };
  let bestIssueCount = Number.POSITIVE_INFINITY;
  let finalStatus: OptimizerOutput["status"] = "max_iterations";
  let finalSummary = "Maximum iterations reached without reviewer pass.";
  let optimizerAgentId = "service:video-prompt-optimizer";
  let optimizerTaskId: string | undefined;
  let completedIterations = 0;
  const allowedRefUrls = allowedImageUrls(status);

  for (let iteration = 1; iteration <= 5; iteration++) {
    throwIfAborted(context?.signal);
    const writerResult = await runSubAgentTask({
      instruction: buildWriterInstruction({
        canonicalContext,
        iteration,
        previousPromptBriefs: latestPrompts ? summarizePrompts(latestPrompts) : null,
        latestReviewSummary: latestReview?.summary ?? null,
        blockingIssues: latestReview ? summarizeIssues(latestReview.issues, true) : [],
        iterationBriefs,
        doNotRegress,
      }),
      skills: [...WRITER_SKILLS],
      outputSchema: writerOutputSchemaForSubAgent,
      maxRetries: 2,
      includeTrace: true,
      keyJsonTitle: `EP${episode.scriptKey.replace(/^EP/i, "")} Prompt Writer Iteration ${iteration}`,
      model: PROMPT_WRITER_MODEL,
    }, context);
    if (writerResult.taskId && !optimizerTaskId) optimizerTaskId = writerResult.taskId;
    optimizerAgentId = writerResult.agentId;
    if (context?.signal?.aborted || writerResult.status === "cancelled") {
      throw new Error("Video prompt optimization cancelled");
    }
    if (writerResult.status !== "completed") {
      finalSummary = `Prompt Writer failed at iteration ${iteration}: ${writerResult.error ?? writerResult.status}`;
      finalStatus = "failed";
      break;
    }
    const rawWriterOutput = parseJsonOutput(RawWriterOutputSchema, writerResult.output);
    const refUrlValidation = validateWriterRefUrls(rawWriterOutput, allowedRefUrls);
    const writerOutput = WriterOutputSchema.parse({
      prompts: refUrlValidation.prompts,
      summary: rawWriterOutput.summary,
    });
    latestPrompts = writerOutput.prompts;
    finalPrompts = writerOutput.prompts;

    if (refUrlValidation.issues.length > 0) {
      const review = buildSyntheticRefUrlReview(refUrlValidation);
      latestReview = review;
      finalReview = review;
      completedIterations = iteration;
      remainingIssues = review.issues;
      newIssues = review.issues;
      doNotRegress = mergeDoNotRegress(doNotRegress, review.suggestions);

      const historyItem: Prisma.InputJsonObject = {
        iteration,
        writerTaskId: writerResult.taskId ?? null,
        writerAgentId: writerResult.agentId,
        reviewerTaskId: null,
        reviewerAgentId: null,
        promptCount: writerOutput.prompts.length,
        passed: review.passed,
        allowVideoGeneration: review.allowVideoGeneration,
        issueCount: review.issues.length,
        writerSummary: writerOutput.summary,
        reviewerSummary: review.summary,
        issues: review.issues as Prisma.InputJsonArray,
        suggestions: review.suggestions,
      };
      iterationHistory.push(historyItem);
      iterationBriefs.push({
        iteration,
        promptCount: writerOutput.prompts.length,
        passed: review.passed,
        allowVideoGeneration: review.allowVideoGeneration,
        issueCount: review.issues.length,
        blockingIssueCount: review.issues.filter(isBlockingIssue).length,
        writerSummary: writerOutput.summary,
        reviewerSummary: review.summary,
        issueIds: review.issues.map(issueIdentity).slice(0, 24),
      });

      if (issueCount(review) < bestIssueCount) {
        bestIssueCount = issueCount(review);
        bestVersion = {
          iteration,
          prompts: writerOutput.prompts,
          review,
          reason: `Fewest reviewer issues so far (${issueCount(review)}).`,
        };
      }

      continue;
    }

    throwIfAborted(context?.signal);
    const reviewerResult = await runSubAgentTask({
      instruction: buildReviewerInstruction({
        canonicalContext,
        iteration,
        prompts: writerOutput.prompts,
        iterationBriefs,
        doNotRegress,
      }),
      skills: [...REVIEWER_SKILLS],
      outputSchema: reviewOutputSchemaForSubAgent,
      maxRetries: 2,
      includeTrace: true,
      keyJsonTitle: `EP${episode.scriptKey.replace(/^EP/i, "")} Prompt Reviewer Iteration ${iteration}`,
      model: PROMPT_REVIEWER_MODEL,
    }, context);
    optimizerAgentId = reviewerResult.agentId;
    if (context?.signal?.aborted || reviewerResult.status === "cancelled") {
      throw new Error("Video prompt optimization cancelled");
    }
    if (reviewerResult.status !== "completed") {
      finalSummary = `Prompt Reviewer failed at iteration ${iteration}: ${reviewerResult.error ?? reviewerResult.status}`;
      finalStatus = "failed";
      break;
    }

    const review = parseJsonOutput(ReviewSchema, reviewerResult.output);
    latestReview = review;
    finalReview = review;
    completedIterations = iteration;
    remainingIssues = review.issues;
    newIssues = review.issues;
    doNotRegress = mergeDoNotRegress(doNotRegress, review.suggestions);

    const historyItem: Prisma.InputJsonObject = {
      iteration,
      writerTaskId: writerResult.taskId ?? null,
      writerAgentId: writerResult.agentId,
      reviewerTaskId: reviewerResult.taskId ?? null,
      reviewerAgentId: reviewerResult.agentId,
      promptCount: writerOutput.prompts.length,
      passed: review.passed,
      allowVideoGeneration: review.allowVideoGeneration,
      issueCount: review.issues.length,
      writerSummary: writerOutput.summary,
      reviewerSummary: review.summary,
      issues: review.issues as Prisma.InputJsonArray,
      suggestions: review.suggestions,
    };
    iterationHistory.push(historyItem);
    iterationBriefs.push({
      iteration,
      promptCount: writerOutput.prompts.length,
      passed: review.passed,
      allowVideoGeneration: review.allowVideoGeneration,
      issueCount: review.issues.length,
      blockingIssueCount: review.issues.filter(isBlockingIssue).length,
      writerSummary: writerOutput.summary,
      reviewerSummary: review.summary,
      issueIds: review.issues.map(issueIdentity).slice(0, 24),
    });

    if (issueCount(review) < bestIssueCount) {
      bestIssueCount = issueCount(review);
      bestVersion = {
        iteration,
        prompts: writerOutput.prompts,
        review,
        reason: `Fewest reviewer issues so far (${issueCount(review)}).`,
      };
    }

    if (review.passed && review.allowVideoGeneration) {
      finalStatus = "passed";
      finalSummary = `Reviewer passed at iteration ${iteration}.`;
      resolvedIssues.push(...review.issues);
      remainingIssues = [];
      newIssues = [];
      break;
    }
  }

  const optimizerOutput = buildOptimizerOutput({
    status: finalStatus,
    iterationCount: completedIterations,
    finalPrompts,
    finalReview,
    iterationHistory,
    resolvedIssues,
    remainingIssues,
    newIssues,
    doNotRegress,
    bestVersion,
    summary: finalSummary,
  });
  const savedPrompts: SavedPrompt[] = [];

  if (input.savePrompts && optimizerOutput.status === "passed" && optimizerOutput.finalReview.passed) {
    const promptData = toPromptData(optimizerOutput);
    await deleteStaleReviewedPromptResources(
      input.scriptId,
      optimizerOutput.finalPrompts.map((prompt) => prompt.key),
    );
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
            shot_function: prompt.shot_function,
            prev_shot_recap: prompt.prev_shot_recap,
            next_shot_setup: prompt.next_shot_setup,
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
    optimizerTaskId,
    optimizerAgentId,
    iterationCount: optimizerOutput.iterationCount,
    promptCount: optimizerOutput.finalPrompts.length,
    savedPrompts,
    remainingIssues: optimizerOutput.remainingIssues,
    summary: optimizerOutput.summary,
  };
}
