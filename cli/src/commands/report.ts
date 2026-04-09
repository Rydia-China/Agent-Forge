import { Command } from "commander";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { printTranscript, printSummary } from "../format/terminal.js";
import type { EvalSummary, Trace, AssertionResult, JudgeResult } from "../types.js";

const EVALS_DIR = join(import.meta.dirname, "../../evals");

function getLatestEvalId(): string | null {
  let entries: string[];
  try {
    entries = readdirSync(EVALS_DIR);
  } catch {
    return null;
  }
  const sorted = entries.filter((e) => !e.startsWith(".")).sort().reverse();
  return sorted[0] ?? null;
}

function loadSummary(evalId: string): EvalSummary {
  const path = join(EVALS_DIR, evalId, "summary.json");
  return JSON.parse(readFileSync(path, "utf-8")) as EvalSummary;
}

export const reportCommand = new Command("report")
  .description("View eval results")
  .argument("[eval-id]", "Eval ID (default: latest)")
  .option("--case <name>", "Show specific case detail")
  .option("--run <n>", "Show specific run", parseInt)
  .option("--transcript", "Show full transcript")
  .action((evalId: string | undefined, opts: Record<string, unknown>) => {
    const id = evalId ?? getLatestEvalId();
    if (!id) {
      console.log("No eval results found. Run `forge-eval run` first.");
      return;
    }

    let summary: EvalSummary;
    try {
      summary = loadSummary(id);
    } catch {
      console.log(`Eval "${id}" not found.`);
      return;
    }

    // Full transcript view
    if (opts.case && opts.run != null && opts.transcript) {
      const caseName = opts.case as string;
      const runIdx = opts.run as number;
      const tracePath = join(EVALS_DIR, id, caseName, `run-${runIdx}.trace.json`);
      const judgePath = join(EVALS_DIR, id, caseName, `run-${runIdx}.judge.json`);

      let trace: Trace;
      try {
        trace = JSON.parse(readFileSync(tracePath, "utf-8")) as Trace;
      } catch {
        console.log(`Trace not found: ${tracePath}`);
        return;
      }

      let judgeResult: JudgeResult | undefined;
      try {
        judgeResult = JSON.parse(readFileSync(judgePath, "utf-8")) as JudgeResult;
      } catch {
        // No judge result
      }

      const assertions: AssertionResult[] = [];
      if (judgeResult) {
        assertions.push({
          category: "semantic",
          type: "judge",
          pass: judgeResult.pass,
          detail: `score=${judgeResult.score}`,
        });
      }

      printTranscript(trace, assertions, judgeResult);
      return;
    }

    // Case detail view
    if (opts.case) {
      const caseName = opts.case as string;
      const caseInfo = summary.cases.find((c) => c.name === caseName);
      if (!caseInfo) {
        console.log(`Case "${caseName}" not found in eval ${id}`);
        return;
      }
      console.log(`\nCase: ${caseInfo.name} [${caseInfo.tier}]`);
      console.log(`Status: ${caseInfo.status.toUpperCase()}`);
      console.log(`Pass rate: ${(caseInfo.passRate * 100).toFixed(0)}%  pass@${caseInfo.runs}=${caseInfo.passAtK.toFixed(2)}  pass^${caseInfo.runs}=${caseInfo.passExpK.toFixed(2)}`);
      if (caseInfo.avgScore != null) console.log(`Avg score: ${caseInfo.avgScore.toFixed(1)}`);
      console.log(`Avg duration: ${(caseInfo.avgDurationMs / 1000).toFixed(1)}s`);
      if (caseInfo.failureSummary) console.log(`\nFailure: ${caseInfo.failureSummary}`);

      try {
        const statsPath = join(EVALS_DIR, id, caseName, "stats.json");
        const stats = JSON.parse(readFileSync(statsPath, "utf-8"));
        console.log(`\nStats: ${JSON.stringify(stats, null, 2)}`);
      } catch {
        // No stats file
      }
      return;
    }

    // Summary view
    printSummary(summary);
    console.log("");
    for (const c of summary.cases) {
      const icon = c.status === "pass" ? "\x1b[32m\u2713\x1b[0m" : "\x1b[31m\u2717\x1b[0m";
      const scorePart = c.avgScore != null ? ` score=${c.avgScore.toFixed(1)}` : "";
      console.log(`  ${icon} ${c.name} [${c.tier}] rate=${(c.passRate * 100).toFixed(0)}%${scorePart}`);
      if (c.failureSummary) console.log(`    \x1b[2m${c.failureSummary}\x1b[0m`);
    }
  });
