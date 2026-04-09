import OpenAI from "openai";
import type { Trace, SemanticConfig, JudgeResult, AssertionResult } from "../types.js";

function getJudgeClient(): OpenAI {
  return new OpenAI({
    apiKey: process.env.LLM_API_KEY ?? "",
    baseURL: process.env.LLM_BASE_URL || undefined,
  });
}

function buildTraceContent(trace: Trace): string {
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
      lines.push(`${i + 1}. ${tc.name} → ${tc.result ? tc.result.slice(0, 200) + "..." : "(no result)"} (${tc.durationMs}ms)`);
    }
  } else {
    lines.push("(没有工具调用)");
  }
  if (trace.reply) {
    lines.push(`\n最终回复:\n${trace.reply}`);
  }
  return lines.join("\n");
}

/**
 * Run LLM-as-Judge evaluation on a trace.
 */
export async function runJudge(
  trace: Trace,
  config: SemanticConfig,
): Promise<{ result: JudgeResult; assertion: AssertionResult }> {
  const model = config.model ?? "anthropic/claude-sonnet-4.6";
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

  const res = await client.chat.completions.create({
    model,
    messages: [{ role: "user", content: prompt }],
  });

  const raw = res.choices[0]?.message.content ?? "";

  // Parse judge output — strip markdown fences
  const cleaned = raw.trim().replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?\s*```$/, "");
  let judgeResult: JudgeResult;
  try {
    judgeResult = JSON.parse(cleaned) as JudgeResult;
  } catch {
    judgeResult = {
      score: 0,
      pass: false,
      issues: ["judge_parse_error"],
      reasoning: `Failed to parse judge output: ${raw.slice(0, 200)}`,
    };
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
