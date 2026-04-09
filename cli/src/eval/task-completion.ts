import OpenAI from "openai";
import type { Trace, TaskCompletionConfig, AssertionResult } from "../types.js";
import { config as appConfig } from "../config.js";

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
  const fenceMatch = /```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/.exec(cleaned);
  if (fenceMatch) {
    cleaned = fenceMatch[1]!.trim();
  }
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
 * Run LLM-based task completion evaluation on a trace.
 * Retries once on JSON parse failure.
 */
export async function runTaskCompletion(
  trace: Trace,
  config: TaskCompletionConfig,
): Promise<{ score: number; reasoning: string; assertion: AssertionResult }> {
  const model = config.model ?? appConfig.modelController;
  const client = new OpenAI({
    apiKey: appConfig.llmApiKey,
    baseURL: appConfig.llmBaseUrl,
  });

  const traceContent = buildTraceContent(trace);
  const threshold = config.threshold ?? 0.7;

  const prompt = `你是一个任务完成度评估专家。请评估 Agent 是否完成了用户的任务。

## 用户请求
${trace.input.message}

## Agent 行为
${traceContent}

## 评估标准
1. Agent 是否理解了用户的意图？
2. Agent 是否采取了合理的行动？
3. 最终结果是否满足了用户的需求？

## 输出
返回 JSON: { "score": 0.0-1.0, "reasoning": "..." }
score 含义：0.0=完全未完成, 0.5=部分完成, 1.0=完全完成`;

  let score = 0;
  let reasoning = "";

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await client.chat.completions.create({
      model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 512,
    });

    const raw = res.choices[0]?.message.content ?? "";
    const cleaned = extractJSON(raw);

    try {
      const parsed = JSON.parse(cleaned) as { score: number; reasoning: string };
      score = parsed.score;
      reasoning = parsed.reasoning;
      break;
    } catch {
      if (attempt === 0) continue;
      score = 0;
      reasoning = `Failed to parse task completion output after 2 attempts: ${raw.slice(0, 200)}`;
    }
  }

  const pass = score >= threshold;
  const assertion: AssertionResult = {
    category: "task_completion",
    type: "task_completion",
    pass,
    detail: `score=${score.toFixed(2)} ${pass ? "PASS" : "FAIL"}: ${reasoning.slice(0, 100)}`,
    evidence: { score, reasoning },
  };

  return { score, reasoning, assertion };
}
