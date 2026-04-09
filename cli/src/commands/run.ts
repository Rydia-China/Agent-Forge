import { Command } from "commander";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadCases } from "../eval/loader.js";
import { runAssertions } from "../eval/assertions.js";
import { runJudge } from "../eval/judge.js";
import { computeStats, type RunResult } from "../eval/stats.js";
import { runUnitCase } from "../runner/subagent-runner.js";
import { runTraceCase, runWorkflowCase } from "../runner/agent-runner.js";
import { printCaseHeader, printRunProgress, printCaseResult, printSummary, printDryRun } from "../format/terminal.js";
import type { CaseMode, EvalCase, EvalSummary, CaseSummary, Trace, AssertionResult, JudgeResult } from "../types.js";

const EVALS_DIR = join(import.meta.dirname, "../../evals");

export const runCommand = new Command("run")
  .description("Run eval suite")
  .argument("<mode>", "Test mode: unit, trace, workflow, regression")
  .argument("[filter]", "Glob pattern to match case names")
  .option("--runs <n>", "Override run count per case", parseInt)
  .option("--tag <tag>", "Filter by tag (repeatable)", (val: string, prev: string[]) => [...prev, val], [] as string[])
  .option("--tier <tier>", "Filter by tier: capability or regression")
  .option("--api <url>", "Agent-Forge API URL", "http://localhost:8001")
  .option("--dry-run", "Print execution plan without running")
  .option("--save-golden", "Save traces as golden baselines (regression mode)")
  .option("--concurrency <n>", "Max parallel cases", parseInt, 1)
  .action(async (mode: CaseMode, filter: string | undefined, opts: Record<string, unknown>) => {
    const { cases, files } = loadCases({
      mode,
      filter,
      tags: (opts.tag as string[])?.length ? (opts.tag as string[]) : undefined,
      tier: opts.tier as "capability" | "regression" | undefined,
    });

    if (cases.length === 0) {
      console.log("No cases found matching criteria.");
      return;
    }

    if (opts.dryRun) {
      printDryRun(cases.map((c, i) => ({
        name: c.name,
        mode: c.mode,
        runs: (opts.runs as number) ?? c.runs,
        tags: c.tags,
        tier: c.tier,
        file: files[i]!,
      })));
      return;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const evalId = `${timestamp}-${mode}`;
    const evalDir = join(EVALS_DIR, evalId);
    mkdirSync(evalDir, { recursive: true });

    console.log(`\nforge-eval run ${mode}${filter ? ` "${filter}"` : ""}\n`);

    const caseSummaries: CaseSummary[] = [];
    let totalPassed = 0;
    let totalFailed = 0;
    let totalRuns = 0;
    let totalDurationMs = 0;

    for (let ci = 0; ci < cases.length; ci++) {
      const evalCase = cases[ci]!;
      const numRuns = (opts.runs as number) ?? evalCase.runs;
      const caseDir = join(evalDir, evalCase.name);
      mkdirSync(caseDir, { recursive: true });

      printCaseHeader(evalCase.name, numRuns);

      const runResults: RunResult[] = [];

      for (let ri = 0; ri < numRuns; ri++) {
        try {
          let trace: Trace;
          let stepTraces: Trace[] | undefined;

          if (evalCase.mode === "unit") {
            trace = await runUnitCase(evalCase, ri);
          } else if (evalCase.mode === "workflow") {
            stepTraces = await runWorkflowCase(evalCase, ri, opts.api as string);
            trace = stepTraces[stepTraces.length - 1]!;
          } else {
            trace = await runTraceCase(evalCase, ri, opts.api as string);
          }

          const assertions: AssertionResult[] = [];
          if (evalCase.mode === "workflow" && stepTraces && evalCase.steps) {
            for (let si = 0; si < stepTraces.length; si++) {
              const stepAssertions = evalCase.steps[si]?.assertions;
              if (stepAssertions) {
                assertions.push(...runAssertions(stepTraces[si]!, stepAssertions));
              }
            }
          } else if (evalCase.assertions) {
            assertions.push(...runAssertions(trace, evalCase.assertions));
          }

          let judgeResult: JudgeResult | undefined;
          const semanticConfig = evalCase.mode === "workflow"
            ? evalCase.steps?.[evalCase.steps.length - 1]?.assertions?.semantic
            : evalCase.assertions?.semantic;
          if (semanticConfig) {
            const judge = await runJudge(trace, semanticConfig);
            judgeResult = judge.result;
            assertions.push(judge.assertion);
          }

          const allPass = assertions.every((a) => a.pass);
          const durationSec = trace.totalDurationMs / 1000;

          printRunProgress(evalCase.name, ri, numRuns, allPass, judgeResult?.score, durationSec,
            allPass ? undefined : assertions.find((a) => !a.pass)?.detail);

          writeFileSync(join(caseDir, `run-${ri}.trace.json`), JSON.stringify(trace, null, 2));
          if (judgeResult) {
            writeFileSync(join(caseDir, `run-${ri}.judge.json`), JSON.stringify(judgeResult, null, 2));
          }

          if (opts.saveGolden && evalCase.mode === "regression" && allPass) {
            const goldenDir = join(import.meta.dirname, "../../cases/regression/golden");
            mkdirSync(goldenDir, { recursive: true });
            writeFileSync(join(goldenDir, `${evalCase.name}.trace.json`), JSON.stringify(trace, null, 2));
          }

          runResults.push({ trace, assertions, judgeResult });
          totalRuns++;
          totalDurationMs += trace.totalDurationMs;
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          printRunProgress(evalCase.name, ri, numRuns, false, undefined, 0, errMsg);
          totalRuns++;
        }
      }

      const stats = computeStats(runResults, evalCase.assertions?.consistency);
      writeFileSync(join(caseDir, "stats.json"), JSON.stringify(stats, null, 2));

      const casePass = stats.passRate >= 1.0;
      if (casePass) totalPassed++;
      else totalFailed++;

      printCaseResult(stats.passRate, numRuns, stats.semanticScores?.mean, stats.passAtK, stats.passExpK);

      let failureSummary: string | undefined;
      if (!casePass) {
        const failedAssertions = runResults
          .flatMap((r) => r.assertions.filter((a) => !a.pass))
          .map((a) => a.detail);
        const uniqueFailures = [...new Set(failedAssertions)].slice(0, 3);
        const passCount = Math.round(stats.passRate * numRuns);
        const qualifier = stats.passAtK > 0.9 ? "能做到但不稳定" : "能力不足";
        failureSummary = `${qualifier}: ${passCount}/${numRuns} runs. ${uniqueFailures.join("; ")}`;
      }

      caseSummaries.push({
        name: evalCase.name,
        file: files[ci]!,
        tier: evalCase.tier,
        runs: numRuns,
        passRate: stats.passRate,
        passAtK: stats.passAtK,
        passExpK: stats.passExpK,
        avgScore: stats.semanticScores?.mean,
        avgDurationMs: stats.timing.mean,
        status: casePass ? "pass" : "fail",
        failureSummary,
      });
    }

    const capCases = caseSummaries.filter((c) => c.tier === "capability");
    const regCases = caseSummaries.filter((c) => c.tier === "regression");

    const summary: EvalSummary = {
      evalId,
      mode,
      timestamp: new Date().toISOString(),
      filter: filter ?? null,
      tags: (opts.tag as string[])?.length ? (opts.tag as string[]) : null,
      totalCases: cases.length,
      byTier: {
        capability: {
          total: capCases.length,
          passed: capCases.filter((c) => c.status === "pass").length,
          failed: capCases.filter((c) => c.status === "fail").length,
          passRate: capCases.length > 0 ? capCases.filter((c) => c.status === "pass").length / capCases.length : 1,
        },
        regression: {
          total: regCases.length,
          passed: regCases.filter((c) => c.status === "pass").length,
          failed: regCases.filter((c) => c.status === "fail").length,
          passRate: regCases.length > 0 ? regCases.filter((c) => c.status === "pass").length / regCases.length : 1,
        },
      },
      passed: totalPassed,
      failed: totalFailed,
      passRate: cases.length > 0 ? totalPassed / cases.length : 1,
      totalRuns,
      totalDurationMs,
      cases: caseSummaries,
    };

    writeFileSync(join(evalDir, "summary.json"), JSON.stringify(summary, null, 2));
    printSummary(summary);
  });
