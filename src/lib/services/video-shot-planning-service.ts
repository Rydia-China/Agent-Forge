/**
 * Video Shot Planning Service
 * 
 * Implements the EP-level video generation pipeline:
 * 1. Plan video shots from episode script
 * 2. Review shots with reviewer subagent
 * 3. Iterate until all shots pass review
 * 4. Generate videos using FC API
 */

import { z } from "zod";
import { prisma } from "@/lib/db";
import type {
  VideoShotPlan,
  PlanVideoShotsResult,
  ReviewResult,
  GenerateVideoShotsResult,
} from "@/lib/video/workflow-types";
import * as subagentService from "./subagent-service";
import * as skillService from "./skill-service";
import * as episodeService from "./episode-service";
import * as assetGenerationService from "./video-asset-generation-service";

/* ------------------------------------------------------------------ */
/*  Helper: Execute subagent synchronously                            */
/* ------------------------------------------------------------------ */

async function executeSubagentSync(instruction: string, model: string): Promise<string> {
  const result = await subagentService.submitSubAgent({
    message: instruction,
    model,
  });

  // Wait for completion by subscribing to events
  let output = "";
  for await (const event of subagentService.subscribeEvents(result.subagentId)) {
    if (typeof event === "symbol") {
      // End signal
      break;
    }
    if (event.type === "delta" && typeof event.data === "object" && event.data !== null) {
      const data = event.data as Record<string, unknown>;
      if (typeof data.text === "string") {
        output += data.text;
      }
    }
  }

  return output;
}

/* ------------------------------------------------------------------ */
/*  Zod Schemas                                                        */
/* ------------------------------------------------------------------ */

export const PlanVideoShotsParams = z.object({
  scriptId: z.string().min(1),
  prevEpisodeId: z.string().optional(),
  nextEpisodeId: z.string().optional(),
});

export const ReviewVideoShotsParams = z.object({
  scriptId: z.string().min(1),
  shots: z.array(z.unknown()),
});

export const GenerateVideoShotsParams = z.object({
  scriptId: z.string().min(1),
  prevEpisodeId: z.string().optional(),
  nextEpisodeId: z.string().optional(),
  maxReviewIterations: z.number().int().positive().default(3),
});

/* ------------------------------------------------------------------ */
/*  Plan Video Shots                                                   */
/* ------------------------------------------------------------------ */

/**
 * Generate video shot plans from episode script using main agent
 */
export async function planVideoShots(
  params: z.infer<typeof PlanVideoShotsParams>
): Promise<PlanVideoShotsResult> {
  const { scriptId, prevEpisodeId, nextEpisodeId } = params;

  // Get episode data
  const episode = await episodeService.getEpisode(scriptId);
  if (!episode) {
    throw new Error(`Episode not found: ${scriptId}`);
  }

  const script = await prisma.novelScript.findUnique({
    where: { id: scriptId },
    select: { novelId: true, scriptKey: true },
  });
  if (!script) {
    throw new Error(`Script not found: ${scriptId}`);
  }

  // Load required skills
  const workflowSkill = await skillService.getSkill("video-workflow");
  const directorSkill = await skillService.getSkill("video-director-playbook");
  const lessonsSkill = await skillService.getSkill("video-seedance-lessons");
  const shotIdPolicySkill = await skillService.getSkill("video-shot-id-policy");

  if (!workflowSkill || !directorSkill || !lessonsSkill || !shotIdPolicySkill) {
    throw new Error("Required video skills not found. Run import-video-skills.ts first.");
  }

  // Build context for planning agent
  let contextScript = JSON.stringify(episode.initResult, null, 2);

  // Add prev/next episode context if provided
  if (prevEpisodeId) {
    const prevEp = await episodeService.getEpisode(prevEpisodeId);
    if (prevEp?.initResult) {
      contextScript = `# Previous Episode\n${JSON.stringify(prevEp.initResult, null, 2)}\n\n# Current Episode\n${contextScript}`;
    }
  }

  if (nextEpisodeId) {
    const nextEp = await episodeService.getEpisode(nextEpisodeId);
    if (nextEp?.initResult) {
      contextScript += `\n\n# Next Episode\n${JSON.stringify(nextEp.initResult, null, 2)}`;
    }
  }

  // Create planning instruction
  const instruction = `你是视频生成专家。请根据以下剧本生成所有视频镜头的提示词计划。

## 剧本数据

${contextScript}

## 任务要求

1. 分析剧本的 pre_choice_script，将其拆分为多个视频镜头（shots）
2. 每个镜头时长建议 4-15 秒
3. 为每个镜头生成：
   - shotId: 镜头ID（如 shot_1, shot_2）
   - duration: 时长（秒）
   - mode: 生成模式（单首帧/首尾帧双锚/三层reference）
   - scene: 场景名称
   - shotFunction: 本镜在整集情绪弧里的叙事任务
   - prevShotRecap: 上一镜结尾人物状态
   - nextShotSetup: 下一镜从什么状态开始
   - emotionArc: 情绪弧线
   - assets: 素材引用（images数组，videos永远为空）
   - shotPrompt: 完整的视频生成提示词
   - definition: 素材定义（如 @图1 是 [场景X空镜]，@图2 是 [人物A立绘]）
   - title: 镜头标题

## 重要规则

${workflowSkill.content}

${directorSkill.content}

${lessonsSkill.content}

${shotIdPolicySkill.content}

## 输出格式

返回 JSON 数组，每个元素是一个 VideoShotPlan 对象。

请开始生成视频镜头计划。`;

  // Create subagent for planning
  const output = await executeSubagentSync(instruction, "claude-opus-4");

  // Parse result
  let shots: VideoShotPlan[] = [];
  try {
    // Extract JSON from response
    const jsonMatch = output.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      shots = JSON.parse(jsonMatch[0]) as VideoShotPlan[];
    } else {
      throw new Error("No JSON array found in planning output");
    }
  } catch (error) {
    throw new Error(`Failed to parse planning output: ${error}`);
  }

  return {
    scriptId,
    episodeKey: script.scriptKey,
    shots,
    totalShots: shots.length,
  };
}

/* ------------------------------------------------------------------ */
/*  Review Video Shots                                                 */
/* ------------------------------------------------------------------ */

/**
 * Review video shot plans using reviewer subagent
 */
export async function reviewVideoShots(
  params: z.infer<typeof ReviewVideoShotsParams>
): Promise<ReviewResult> {
  const { scriptId, shots } = params;

  // Get episode data
  const episode = await episodeService.getEpisode(scriptId);
  if (!episode) {
    throw new Error(`Episode not found: ${scriptId}`);
  }

  // Load reviewer skill
  const reviewerSkill = await skillService.getSkill("video-skill-reviewer");
  if (!reviewerSkill) {
    throw new Error("Reviewer skill not found");
  }

  // Build review instruction
  const instruction = `你是视频提示词审查专家。请按照以下标准审查所有视频镜头的提示词。

## 剧本数据

${JSON.stringify(episode.initResult, null, 2)}

## 待审查的镜头

${JSON.stringify(shots, null, 2)}

## 审查标准

${reviewerSkill.content}

## 任务要求

1. 逐个检查每个镜头的提示词
2. 按照 SKILL_REVIEWER.md 的 32 项标准检查
3. 识别所有问题（error 级别必须修复，warning 级别建议改进）
4. 提供具体的修改建议

## 输出格式

返回 JSON 对象：
{
  "passed": boolean,
  "issues": [
    {
      "shotId": "shot_1",
      "category": "W1/W2/...",
      "description": "具体问题描述",
      "severity": "error" | "warning"
    }
  ],
  "suggestions": ["改进建议1", "改进建议2"]
}

请开始审查。`;

  // Create reviewer subagent
  const output = await executeSubagentSync(instruction, "claude-opus-4");

  // Parse result
  let reviewResult: ReviewResult;
  try {
    const jsonMatch = output.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      reviewResult = JSON.parse(jsonMatch[0]) as ReviewResult;
    } else {
      throw new Error("No JSON object found in review output");
    }
  } catch (error) {
    throw new Error(`Failed to parse review output: ${error}`);
  }

  return reviewResult;
}

/* ------------------------------------------------------------------ */
/*  Generate Video Shots (Full Pipeline)                              */
/* ------------------------------------------------------------------ */

/**
 * Complete video generation pipeline:
 * 1. Plan shots
 * 2. Review with reviewer subagent
 * 3. Iterate until all pass
 * 4. Generate videos
 */
export async function generateVideoShots(
  params: z.infer<typeof GenerateVideoShotsParams>
): Promise<GenerateVideoShotsResult> {
  const { scriptId, prevEpisodeId, nextEpisodeId, maxReviewIterations } = params;

  // Step 1: Plan video shots
  console.log("[generateVideoShots] Step 1: Planning shots...");
  let planResult = await planVideoShots({ scriptId, prevEpisodeId, nextEpisodeId });
  let shots = planResult.shots;
  let totalIterations = 0;

  // Step 2-3: Review and iterate
  console.log("[generateVideoShots] Step 2-3: Review and iterate...");
  for (let iteration = 0; iteration < maxReviewIterations; iteration++) {
    totalIterations++;
    console.log(`[generateVideoShots] Review iteration ${iteration + 1}/${maxReviewIterations}`);

    const reviewResult = await reviewVideoShots({ scriptId, shots });

    if (reviewResult.passed) {
      console.log("[generateVideoShots] All shots passed review!");
      break;
    }

    if (iteration === maxReviewIterations - 1) {
      console.warn("[generateVideoShots] Max iterations reached, proceeding with current shots");
      break;
    }

    // Refine shots based on review feedback
    console.log(`[generateVideoShots] Found ${reviewResult.issues.length} issues, refining...`);
    
    // Create refinement instruction
    const refinementInstruction = `请根据审查反馈改进以下视频镜头的提示词。

## 当前镜头

${JSON.stringify(shots, null, 2)}

## 审查反馈

${JSON.stringify(reviewResult, null, 2)}

## 任务要求

1. 修复所有 error 级别的问题
2. 尽量改进 warning 级别的问题
3. 保持镜头的整体结构和叙事逻辑
4. 返回完整的改进后的镜头数组

请返回改进后的 JSON 数组。`;

    const output = await executeSubagentSync(refinementInstruction, "claude-opus-4");

    // Parse refined shots
    try {
      const jsonMatch = output.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        shots = JSON.parse(jsonMatch[0]) as VideoShotPlan[];
      }
    } catch (error) {
      console.error("[generateVideoShots] Failed to parse refined shots:", error);
      break;
    }
  }

  // Step 4: Generate videos
  console.log("[generateVideoShots] Step 4: Generating videos...");
  const generatedShots = await Promise.all(
    shots.map(async (shot, index) => {
      try {
        // Get previous video URL for continuation shots
        let previousVideoUrl: string | undefined;
        if (index > 0 && shot.definition.includes("@视频1")) {
          const prevShot = shots[index - 1];
          if (prevShot) {
            // Try to get the previous video from KeyResource
            const prevKey = prevShot.shotId;
            const prevResource = await prisma.keyResource.findFirst({
              where: {
                scopeType: "script",
                scopeId: scriptId,
                key: prevKey,
                mediaType: "video",
              },
              include: {
                versions: {
                  orderBy: { version: "desc" },
                  take: 1,
                },
              },
            });
            previousVideoUrl = prevResource?.versions[0]?.url ?? undefined;
          }
        }

        const result = await assetGenerationService.executeVideoShot({
          scriptId,
          key: shot.shotId,
          shotPrompt: shot.shotPrompt,
          definition: shot.definition,
          duration: shot.duration,
          previousVideoUrl,
          title: shot.title,
        });

        return {
          shotId: shot.shotId,
          status: "completed" as const,
          videoUrl: result.videoUrl,
          prompt: shot.shotPrompt,
          reviewIterations: totalIterations,
        };
      } catch (error) {
        console.error(`[generateVideoShots] Failed to generate ${shot.shotId}:`, error);
        return {
          shotId: shot.shotId,
          status: "failed" as const,
          prompt: shot.shotPrompt,
          reviewIterations: totalIterations,
        };
      }
    })
  );

  return {
    scriptId,
    episodeKey: planResult.episodeKey,
    shots: generatedShots,
    totalIterations,
  };
}
