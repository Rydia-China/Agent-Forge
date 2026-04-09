import type { EvalSummary, AssertionResult, Trace, JudgeResult } from "../types.js";

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

const CHECK = `${GREEN}✓${RESET}`;
const CROSS = `${RED}✗${RESET}`;
const DOT = `${DIM}·${RESET}`;

export function printRunProgress(
  caseName: string,
  runIndex: number,
  totalRuns: number,
  pass: boolean,
  score: number | undefined,
  durationSec: number,
  error?: string,
): void {
  const icon = pass ? CHECK : CROSS;
  const scorePart = score != null ? ` score=${score}` : "";
  const errPart = error ? ` ${RED}${error}${RESET}` : "";
  console.log(`    run ${runIndex + 1}/${totalRuns} ${icon}${scorePart} (${durationSec.toFixed(1)}s)${errPart}`);
}

export function printCaseHeader(caseName: string, totalRuns: number): void {
  const dots = DOT.repeat(Math.max(1, 40 - caseName.length));
  console.log(`\n  ${BOLD}●${RESET} ${caseName} ${dots} ${totalRuns} runs`);
}

export function printCaseResult(passRate: number, totalRuns: number, avgScore: number | undefined, passAtK: number, passExpK: number): void {
  const passed = Math.round(passRate * totalRuns);
  const status = passRate >= 1.0 ? GREEN : passRate > 0 ? YELLOW : RED;
  const scorePart = avgScore != null ? `  avg_score=${avgScore.toFixed(1)}` : "";
  console.log(`    → ${status}${passRate >= 1.0 ? "PASS" : "FAIL"}${RESET}  rate=${passed}/${totalRuns}${scorePart}  pass@${totalRuns}=${passAtK.toFixed(2)}  pass^${totalRuns}=${passExpK.toFixed(2)}`);
}

export function printSummary(summary: EvalSummary): void {
  console.log(`\n  ${"─".repeat(40)}`);
  const status = summary.passRate >= 1.0 ? GREEN : summary.passRate > 0 ? YELLOW : RED;
  console.log(`  ${summary.totalCases} cases | ${GREEN}${summary.passed} passed${RESET} | ${summary.failed > 0 ? RED : ""}${summary.failed} failed${RESET} | ${status}${(summary.passRate * 100).toFixed(0)}% pass rate${RESET}`);

  if (summary.byTier.regression.total > 0) {
    const regStatus = summary.byTier.regression.passRate >= 1.0 ? GREEN : RED;
    console.log(`  Regression: ${regStatus}${summary.byTier.regression.passed}/${summary.byTier.regression.total}${RESET} | Capability: ${summary.byTier.capability.passed}/${summary.byTier.capability.total}`);
  }

  console.log(`  Total: ${(summary.totalDurationMs / 1000).toFixed(1)}s`);
  console.log(`  Report: evals/${summary.evalId}/summary.json`);
}

export function printTranscript(trace: Trace, assertions: AssertionResult[], judgeResult?: JudgeResult): void {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`Transcript: ${trace.caseFile}, run ${trace.runIndex}`);
  console.log("═".repeat(60));

  console.log(`\n${BOLD}[USER]${RESET} ${trace.input.message}`);

  if (trace.input.videoContext) {
    console.log(`\n${DIM}[CONTEXT]${RESET} ${JSON.stringify(trace.input.videoContext, null, 2)}`);
  }

  if (trace.unitResult) {
    console.log(`\n${BOLD}[OUTPUT]${RESET} ${trace.unitResult.raw.slice(0, 500)}${trace.unitResult.raw.length > 500 ? "..." : ""}`);
    if (trace.unitResult.validated) console.log(`${GREEN}[Schema: PASS]${RESET}`);
    if (trace.unitResult.schemaErrors?.length) console.log(`${RED}[Schema errors: ${trace.unitResult.schemaErrors.join("; ")}]${RESET}`);
  }

  if (trace.toolCalls?.length) {
    console.log("");
    for (const tc of trace.toolCalls) {
      const resultPreview = tc.result ? tc.result.slice(0, 80) : "";
      console.log(`${BOLD}[TOOL]${RESET} ${tc.name} → ${resultPreview}${resultPreview.length >= 80 ? "..." : ""} (${(tc.durationMs / 1000).toFixed(1)}s)`);
    }
  }

  if (trace.reply) {
    console.log(`\n${BOLD}[REPLY]${RESET} ${trace.reply}`);
  }

  console.log(`\n${"─".repeat(30)} Assertions ${"─".repeat(19)}`);
  for (const a of assertions) {
    const icon = a.pass ? CHECK : CROSS;
    console.log(`  ${icon} ${a.category}/${a.type}: ${a.detail}`);
  }
  if (judgeResult) {
    const icon = judgeResult.pass ? CHECK : CROSS;
    console.log(`  ${icon} semantic: score=${judgeResult.score} "${judgeResult.reasoning.slice(0, 80)}"`);
  }

  const allPass = assertions.every((a) => a.pass) && (judgeResult ? judgeResult.pass : true);
  console.log(`\n${"═".repeat(20)} Result: ${allPass ? `${GREEN}PASS${RESET}` : `${RED}FAIL${RESET}`} ${"═".repeat(20)}`);
}

export function printDryRun(cases: Array<{ name: string; mode: string; runs: number; tags: string[]; tier: string; file: string }>): void {
  console.log(`\n${BOLD}Dry Run — ${cases.length} cases would execute:${RESET}\n`);
  for (const c of cases) {
    console.log(`  ${c.name} [${c.mode}] ×${c.runs} ${DIM}tier=${c.tier} tags=${c.tags.join(",")}${RESET}`);
    console.log(`    ${DIM}${c.file}${RESET}`);
  }
  console.log("");
}
