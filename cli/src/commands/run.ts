import { Command } from "commander";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadCases } from "../eval/loader.js";
import { runAssertions, evalToolCorrectness } from "../eval/assertions.js";
import { runJudge } from "../eval/judge.js";
import { runTaskCompletion } from "../eval/task-completion.js";
import { computeStats, type RunResult } from "../eval/stats.js";
import { runUnitCase } from "../runner/subagent-runner.js";
import { runTraceCase, runWorkflowCase } from "../runner/agent-runner.js";
import { printCaseHeader, printRunProgress, printCaseResult, printSummary, printDryRun } from "../format/terminal.js";
import type { CaseMode, EvalCase, EvalSummary, CaseSummary, Trace, AssertionResult, JudgeResult, DimensionBreakdown } from "../types.js";
import { config } from "../config.js";

const EVALS_DIR = join(import.meta.dirname, "../../evals");

export const runCommand = new Command("run")
  .description("Run eval suite")
  .argument("<mode>", "Test mode: unit, trace, workflow, regression")
  .argument("[filter]", "Glob pattern to match case names")
  .option("--runs <n>", "Override run count per case", parseInt)
  .option("--tag <tag>", "Filter by tag (repeatable)", (val: string, prev: string[]) => [...prev, val], [] as string[])
  .option("--tier <tier>", "Filter by tier: capability or regression")
  .option("--api <url>", "Agent-Forge API URL")
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
            stepTraces = await runWorkflowCase(evalCase, ri, (opts.api as string | undefined) ?? config.apiUrl);
            trace = stepTraces[stepTraces.length - 1]!;
          } else {
            trace = await runTraceCase(evalCase, ri, (opts.api as string | undefined) ?? config.apiUrl);
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

          // Tool correctness scoring
          let toolCorrectnessScore: number | undefined;
          let toolCorrectnessDetail: { selection: number; ordering: number; parameters: number } | undefined;
          if (evalCase.expected_tools && evalCase.assertions?.tool_correctness) {
            const tcResult = evalToolCorrectness(trace, evalCase.expected_tools, evalCase.assertions.tool_correctness);
            assertions.push(tcResult);
            const ev = tcResult.evidence as { combined: number; selection: number; ordering: number; parameters: number } | undefined;
            if (ev) {
              toolCorrectnessScore = ev.combined;
              toolCorrectnessDetail = { selection: ev.selection, ordering: ev.ordering, parameters: ev.parameters };
            }
          }

          // Semantic judge
          let judgeResult: JudgeResult | undefined;
          const semanticConfig = evalCase.mode === "workflow"
            ? evalCase.steps?.[evalCase.steps.length - 1]?.assertions?.semantic
            : evalCase.assertions?.semantic;
          if (semanticConfig) {
            const judge = await runJudge(trace, semanticConfig);
            judgeResult = judge.result;
            assertions.push(judge.assertion);
          }

          // Task completion (automatic, no rubric needed)
          const taskCompConfig = evalCase.assertions?.task_completion;
          if (taskCompConfig) {
            const tc = await runTaskCompletion(trace, taskCompConfig);
            assertions.push(tc.assertion);
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

          runResults.push({ trace, assertions, judgeResult, toolCorrectnessScore, toolCorrectnessDetail });
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

      printCaseResult(stats.passRate, numRuns, stats.semanticScores?.mean, stats.passAtK, stats.passExpK, stats.ci95);

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
        ci95: stats.ci95,
        avgScore: stats.semanticScores?.mean,
        avgToolCorrectness: stats.toolCorrectness?.mean,
        avgDurationMs: stats.timing.mean,
        status: casePass ? "pass" : "fail",
        failureSummary,
        toolStats: stats.toolStats,
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

    // Aggregate tool stats across all cases
    const allToolCalls = caseSummaries
      .filter((c) => c.toolStats)
      .flatMap((c) => Object.entries(c.toolStats!.byTool).map(([name, s]) => ({ name, ...s })));
    if (allToolCalls.length > 0) {
      const byTool: Record<string, { total: number; errors: number; successRate: number }> = {};
      let totalT = 0, totalE = 0;
      for (const tc of allToolCalls) {
        if (!byTool[tc.name]) byTool[tc.name] = { total: 0, errors: 0, successRate: 0 };
        byTool[tc.name].total += tc.total;
        byTool[tc.name].errors += tc.errors;
        totalT += tc.total;
        totalE += tc.errors;
      }
      for (const v of Object.values(byTool)) {
        v.successRate = v.total > 0 ? (v.total - v.errors) / v.total : 1;
      }
      summary.toolStats = {
        totalCalls: totalT,
        successCount: totalT - totalE,
        failCount: totalE,
        successRate: totalT > 0 ? (totalT - totalE) / totalT : 1,
        avgDurationMs: 0,
        byTool,
      };
    }

    // Dimension breakdown by tag
    const tagMap = new Map<string, { passed: number; total: number }>();
    for (let ci = 0; ci < cases.length; ci++) {
      const c = cases[ci]!;
      const cs = caseSummaries[ci]!;
      for (const tag of c.tags) {
        if (!tagMap.has(tag)) tagMap.set(tag, { passed: 0, total: 0 });
        const t = tagMap.get(tag)!;
        t.total++;
        if (cs.status === "pass") t.passed++;
      }
    }
    if (tagMap.size > 0) {
      const dimensionBreakdown: Record<string, DimensionBreakdown> = {};
      for (const [tag, { passed, total }] of tagMap) {
        const rate = total > 0 ? passed / total : 1;
        const p = rate;
        const z = 1.96;
        const denom = 1 + z * z / total;
        const centre = p + z * z / (2 * total);
        const spread = z * Math.sqrt((p * (1 - p) + z * z / (4 * total)) / total);
        dimensionBreakdown[tag] = {
          cases: total,
          passRate: rate,
          ci95: {
            lower: Math.max(0, (centre - spread) / denom),
            upper: Math.min(1, (centre + spread) / denom),
          },
        };
      }
      summary.dimensionBreakdown = dimensionBreakdown;
    }

    writeFileSync(join(evalDir, "summary.json"), JSON.stringify(summary, null, 2));
    printSummary(summary);

    // Print tool stats table
    if (summary.toolStats && Object.keys(summary.toolStats.byTool).length > 0) {
      console.log("\n  \x1b[1m═══ Tool Success Rate ═══\x1b[0m\n");
      console.log("  %-35s %6s %8s %8s", "Tool", "Calls", "Success", "Rate");
      for (const [name, s] of Object.entries(summary.toolStats.byTool).sort((a, b) => b[1].total - a[1].total)) {
        const rate = (s.successRate * 100).toFixed(1) + "%";
        const color = s.successRate >= 0.95 ? "\x1b[32m" : s.successRate >= 0.8 ? "\x1b[33m" : "\x1b[31m";
        console.log(`  %-35s %6d %8d ${color}%8s\x1b[0m`, name, s.total, s.total - s.errors, rate);
      }
      const ts = summary.toolStats;
      console.log(`  ${"─".repeat(60)}`);
      console.log(`  %-35s %6d %8d %8s`, "TOTAL", ts.totalCalls, ts.successCount, (ts.successRate * 100).toFixed(1) + "%");
    }

    // Print dimension breakdown
    if (summary.dimensionBreakdown && Object.keys(summary.dimensionBreakdown).length > 0) {
      console.log("\n  \x1b[1m═══ Dimension Breakdown ═══\x1b[0m\n");
      console.log("  %-18s %6s %10s %14s", "Tag", "Cases", "Pass Rate", "95% CI");
      for (const [tag, d] of Object.entries(summary.dimensionBreakdown).sort((a, b) => a[1].passRate - b[1].passRate)) {
        const rate = (d.passRate * 100).toFixed(0) + "%";
        const ci = `[${(d.ci95.lower * 100).toFixed(0)}%, ${(d.ci95.upper * 100).toFixed(0)}%]`;
        const color = d.passRate >= 0.9 ? "\x1b[32m" : d.passRate >= 0.7 ? "\x1b[33m" : "\x1b[31m";
        console.log(`  %-18s %6d ${color}%10s\x1b[0m %14s`, tag, d.cases, rate, ci);
      }
    }
    console.log("");
  });
