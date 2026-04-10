import OpenAI from "openai";
import type { Trace, SemanticConfig, JudgeResult, AssertionResult } from "../types.js";
import { config as appConfig } from "../config.js";

function getJudgeClient(): OpenAI {
  return new OpenAI({
    apiKey: appConfig.llmApiKey,
    baseURL: appConfig.llmBaseUrl,
  });
}

export function buildTraceContent(trace: Trace): string {
  if (trace.mode === "unit") {
    const ur = trace.unitResult;
    if (!ur) return "(no unit result)";
    const lines = [`Raw output (${ur.raw.length} chars):`];
    lines.push(ur.raw.slice(0, 2000));
    if (ur.validated) lines.push("\n[Schema validation: PASS]");
    if (ur.schemaErrors?.length) lines.push(`\n[Schema errors: ${ur.schemaErrors.join("; ")}]`);
    return lines.join("\n");
  }

  const lines: string[] = [];
  if (trace.toolCalls?.length) {
    lines.push("工具调用序列:");
    for (let i = 0; i < trace.toolCalls.length; i++) {
      const tc = trace.toolCalls[i]!;
      const status = tc.error ? `ERROR: ${tc.error}` : (tc.result ? tc.result.slice(0, 200) : "ok");
      lines.push(`${i + 1}. ${tc.name} → ${status} (${tc.durationMs}ms)`);
    }
    const errCount = trace.toolCalls.filter((tc) => tc.error).length;
    lines.push(`\n[工具调用总计: ${trace.toolCalls.length}, 失败: ${errCount}]`);
  } else {
    lines.push("(没有工具调用)");
  }
  if (trace.reply) {
    lines.push(`\n最终回复:\n${trace.reply}`);
  }
  return lines.join("\n");
}

/** Try to extract valid JSON from raw LLM output */
function extractJSON(raw: string): string {
  let cleaned = raw.trim();
  // Try to extract JSON block from markdown fences first
  const fenceMatch = /```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/.exec(cleaned);
  if (fenceMatch) {
    cleaned = fenceMatch[1]!.trim();
  }
  // If no fences, try to find the first { ... } block
  if (!cleaned.startsWith("{")) {
    const jsonStart = cleaned.indexOf("{");
    const jsonEnd = cleaned.lastIndexOf("}");
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      cleaned = cleaned.slice(jsonStart, jsonEnd + 1);
    }
  }
  return cleaned;
}

/**
 * G-Eval: two-step Chain-of-Thought evaluation.
 * Step 1 generates evaluation criteria from the rubric.
 * Step 2 scores the trace against each criterion.
 * Falls back to direct mode on step-1 parse failure.
 */
async function runGEval(
  trace: Trace,
  config: SemanticConfig,
): Promise<{ result: JudgeResult; assertion: AssertionResult }> {
  const model = config.model ?? appConfig.modelController;
  const client = getJudgeClient();

  // Step 1: Generate evaluation criteria from rubric
  const step1Prompt = `根据以下评分标准，生成 3-5 个具体的评估维度，每个维度包含名称和描述。
评分标准: ${config.rubric}
返回 JSON: { "steps": [{ "name": "...", "description": "..." }] }`;

  const step1Res = await client.chat.completions.create({
    model,
    messages: [{ role: "user", content: step1Prompt }],
    max_tokens: 1024,
  });

  const step1Raw = step1Res.choices[0]?.message.content ?? "";
  let steps: { name: string; description: string }[];

  try {
    const parsed = JSON.parse(extractJSON(step1Raw)) as { steps: { name: string; description: string }[] };
    steps = parsed.steps;
    if (!Array.isArray(steps) || steps.length === 0) throw new Error("empty steps");
  } catch {
    // Fall back to direct mode on step-1 parse failure
    return runJudgeDirect(trace, config);
  }

  // Step 2: Score all criteria in one call
  const traceContent = buildTraceContent(trace);
  const stepsFormatted = steps.map((s, i) => `${i + 1}. ${s.name}: ${s.description}`).join("\n");

  const step2Prompt = `你是 Agent 行为评估专家。请按以下评估维度逐项打分。

## 被测场景
用户输入: ${trace.input.message}

## Agent 行为
${traceContent}

## 评估维度
${stepsFormatted}

## 输出
返回 JSON: { "scores": [{ "name": "...", "score": 1-5, "reasoning": "..." }] }
每项 score >= ${config.pass_threshold} 为该维度通过。`;

  let scores: { name: string; score: number; reasoning: string }[] | undefined;
  let step2Raw = "";

  // Retry step 2 up to 2 times on parse failure
  for (let attempt = 0; attempt < 2; attempt++) {
    const step2Res = await client.chat.completions.create({
      model,
      messages: [{ role: "user", content: step2Prompt }],
      max_tokens: 1024,
    });

    step2Raw = step2Res.choices[0]?.message.content ?? "";

    try {
      const parsed = JSON.parse(extractJSON(step2Raw)) as { scores: { name: string; score: number; reasoning: string }[] };
      scores = parsed.scores;
      if (!Array.isArray(scores) || scores.length === 0) throw new Error("empty scores");
      break;
    } catch {
      if (attempt === 0) continue;
    }
  }

  if (!scores) {
    // All retries failed — fall back to direct mode
    return runJudgeDirect(trace, config);
  }

  // Compute final score as mean of all step scores
  const finalScore = scores.reduce((sum, s) => sum + s.score, 0) / scores.length;
  const pass = finalScore >= config.pass_threshold;

  // Build per-step reasoning for observability
  const perStepDetail = scores.map((s) => `[${s.name}: ${s.score}/5${s.score >= config.pass_threshold ? " PASS" : " FAIL"}] ${s.reasoning}`).join("\n");

  const judgeResult: JudgeResult = {
    score: Math.round(finalScore * 100) / 100,
    pass,
    issues: scores.filter((s) => s.score < config.pass_threshold).map((s) => s.name),
    reasoning: `G-Eval (mean=${finalScore.toFixed(2)}, threshold=${config.pass_threshold})\n${perStepDetail}`,
  };

  const assertion: AssertionResult = {
    category: "semantic",
    type: "judge",
    pass: judgeResult.pass,
    detail: `score=${judgeResult.score} ${judgeResult.pass ? "PASS" : "FAIL"}: ${judgeResult.reasoning.slice(0, 100)}`,
    evidence: judgeResult,
  };

  return { result: judgeResult, assertion };
}

/**
 * Run LLM-as-Judge evaluation on a trace.
 * Retries once on JSON parse failure.
 */
export async function runJudge(
  trace: Trace,
  config: SemanticConfig,
): Promise<{ result: JudgeResult; assertion: AssertionResult }> {
  if (config.mode === "g-eval") {
    return runGEval(trace, config);
  }
  return runJudgeDirect(trace, config);
}

/**
 * Direct judge mode: single-prompt LLM-as-Judge with retry.
 */
async function runJudgeDirect(
  trace: Trace,
  config: SemanticConfig,
): Promise<{ result: JudgeResult; assertion: AssertionResult }> {
  const model = config.model ?? appConfig.modelController;
  const client = getJudgeClient();

  const prompt = `你是一个 Agent 行为评估专家。请严格按评分标准打分。

## 被测场景
用户输入: ${trace.input.message}
${trace.input.videoContext ? `视频上下文: ${JSON.stringify(trace.input.videoContext)}` : ""}

## Agent 行为
${buildTraceContent(trace)}

## 评分标准
${config.rubric}

## 输出
返回 JSON: { "score": 1-5, "pass": true/false, "issues": [...], "reasoning": "..." }
score >= ${config.pass_threshold} 时 pass 为 true。
如果信息不足以判断，返回 { "score": 0, "pass": false, "issues": ["insufficient_info"], "reasoning": "..." }`;

  let judgeResult: JudgeResult | undefined;

  // Try up to 2 times (original + 1 retry on parse failure)
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await client.chat.completions.create({
      model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1024,
    });

    const raw = res.choices[0]?.message.content ?? "";
    const cleaned = extractJSON(raw);

    try {
      judgeResult = JSON.parse(cleaned) as JudgeResult;
      break; // Success — exit retry loop
    } catch {
      if (attempt === 0) {
        // First failure — retry
        continue;
      }
      // Second failure — give up
      judgeResult = {
        score: 0,
        pass: false,
        issues: ["judge_parse_error"],
        reasoning: `Failed to parse judge output after 2 attempts: ${raw.slice(0, 200)}`,
      };
    }
  }

  if (!judgeResult) {
    judgeResult = { score: 0, pass: false, issues: ["judge_no_response"], reasoning: "No judge response" };
  }

  const assertion: AssertionResult = {
    category: "semantic",
    type: "judge",
    pass: judgeResult.pass,
    detail: `score=${judgeResult.score} ${judgeResult.pass ? "PASS" : "FAIL"}: ${judgeResult.reasoning.slice(0, 100)}`,
    evidence: judgeResult,
  };

  return { result: judgeResult, assertion };
}
