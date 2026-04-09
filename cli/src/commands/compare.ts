import { Command } from "commander";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { EvalSummary, CaseSummary } from "../types.js";

const EVALS_DIR = join(import.meta.dirname, "../../evals");

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

/* ------------------------------------------------------------------ */
/*  Fisher exact test (two-tailed)                                     */
/* ------------------------------------------------------------------ */

function logFactorial(n: number): number {
  let result = 0;
  for (let i = 2; i <= n; i++) result += Math.log(i);
  return result;
}

/** Log-probability of a single hypergeometric table. */
function tableLogP(a: number, b: number, c: number, d: number): number {
  const n = a + b + c + d;
  return (
    logFactorial(a + b) +
    logFactorial(c + d) +
    logFactorial(a + c) +
    logFactorial(b + d) -
    logFactorial(n) -
    logFactorial(a) -
    logFactorial(b) -
    logFactorial(c) -
    logFactorial(d)
  );
}

/**
 * Two-tailed Fisher exact test.
 * Sums probabilities of all tables whose probability <= the observed table's.
 *
 * Contingency table layout:
 *   | pass  fail |
 *   |  a     b   |  eval1
 *   |  c     d   |  eval2
 */
function fisherExactTwoTailed(a: number, b: number, c: number, d: number): number {
  const row1 = a + b;
  const row2 = c + d;
  const col1 = a + c;
  const n = a + b + c + d;

  const observedLogP = tableLogP(a, b, c, d);

  // Enumerate all valid tables holding marginals fixed.
  // a ranges from max(0, col1 - row2) to min(row1, col1).
  const aMin = Math.max(0, col1 - row2);
  const aMax = Math.min(row1, col1);

  let pSum = 0;
  for (let ai = aMin; ai <= aMax; ai++) {
    const bi = row1 - ai;
    const ci = col1 - ai;
    const di = row2 - ci;
    const lp = tableLogP(ai, bi, ci, di);
    // Include tables as extreme or more extreme than observed
    if (lp <= observedLogP + 1e-10) {
      pSum += Math.exp(lp);
    }
  }

  return Math.min(pSum, 1.0);
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function loadSummary(evalId: string): EvalSummary {
  const path = join(EVALS_DIR, evalId, "summary.json");
  return JSON.parse(readFileSync(path, "utf-8")) as EvalSummary;
}

function pct(v: number): string {
  return `${(v * 100).toFixed(0)}%`;
}

function deltaStr(delta: number): string {
  const sign = delta > 0 ? "+" : "";
  const color = delta > 0 ? GREEN : delta < 0 ? RED : DIM;
  return `${color}${sign}${(delta * 100).toFixed(0)}%${RESET}`;
}

function sigLabel(p: number): string {
  if (p < 0.01) return `${BOLD}**${RESET}`;
  if (p < 0.05) return `${BOLD}*${RESET}`;
  return "";
}

function pad(s: string, width: number): string {
  // Strip ANSI for length calculation
  const visible = s.replace(/\x1b\[[0-9;]*m/g, "");
  const diff = width - visible.length;
  return diff > 0 ? s + " ".repeat(diff) : s;
}

/* ------------------------------------------------------------------ */
/*  Compare command                                                    */
/* ------------------------------------------------------------------ */

export const compareCommand = new Command("compare")
  .description("A/B comparison of two eval runs")
  .argument("<eval-id-1>", "First eval ID (baseline)")
  .argument("<eval-id-2>", "Second eval ID (candidate)")
  .action((id1: string, id2: string) => {
    let s1: EvalSummary;
    let s2: EvalSummary;
    try {
      s1 = loadSummary(id1);
    } catch {
      console.log(`Eval "${id1}" not found.`);
      return;
    }
    try {
      s2 = loadSummary(id2);
    } catch {
      console.log(`Eval "${id2}" not found.`);
      return;
    }

    const map1 = new Map<string, CaseSummary>();
    const map2 = new Map<string, CaseSummary>();
    for (const c of s1.cases) map1.set(c.name, c);
    for (const c of s2.cases) map2.set(c.name, c);

    // Collect all case names preserving order (eval1 first, then new in eval2)
    const allNames: string[] = [];
    const seen = new Set<string>();
    for (const c of s1.cases) {
      allNames.push(c.name);
      seen.add(c.name);
    }
    for (const c of s2.cases) {
      if (!seen.has(c.name)) allNames.push(c.name);
    }

    // Column widths
    const COL_CASE = 30;
    const COL_RATE = 9;
    const COL_DELTA = 10;
    const COL_P = 10;
    const COL_SIG = 4;
    const SEP = "─".repeat(COL_CASE + COL_RATE * 2 + COL_DELTA + COL_P + COL_SIG);

    console.log(`\n  ${BOLD}forge-eval compare${RESET} ${id1} vs ${id2}\n`);

    // Header
    console.log(
      `  ${pad("Case", COL_CASE)}${pad("Eval1", COL_RATE)}${pad("Eval2", COL_RATE)}${pad("Delta", COL_DELTA)}${pad("p-value", COL_P)}Sig`,
    );
    console.log(`  ${SEP}`);

    // Per-case rows
    for (const name of allNames) {
      const c1 = map1.get(name);
      const c2 = map2.get(name);

      if (c1 && c2) {
        const delta = c2.passRate - c1.passRate;
        // Build contingency table: pass/fail counts
        const a = Math.round(c1.passRate * c1.runs); // eval1 pass
        const b = c1.runs - a; // eval1 fail
        const c = Math.round(c2.passRate * c2.runs); // eval2 pass
        const d = c2.runs - c; // eval2 fail
        const p = fisherExactTwoTailed(a, b, c, d);

        console.log(
          `  ${pad(name, COL_CASE)}${pad(pct(c1.passRate), COL_RATE)}${pad(pct(c2.passRate), COL_RATE)}${pad(deltaStr(delta), COL_DELTA)}${pad(p.toFixed(3), COL_P)}${sigLabel(p)}`,
        );
      } else if (c1) {
        console.log(
          `  ${pad(name, COL_CASE)}${pad(pct(c1.passRate), COL_RATE)}${pad(`${DIM}---${RESET}`, COL_RATE)}${pad(`${DIM}(removed)${RESET}`, COL_DELTA)}`,
        );
      } else if (c2) {
        console.log(
          `  ${pad(name, COL_CASE)}${pad(`${DIM}---${RESET}`, COL_RATE)}${pad(pct(c2.passRate), COL_RATE)}${pad(`${DIM}(new)${RESET}`, COL_DELTA)}`,
        );
      }
    }

    // Overall row
    console.log(`  ${SEP}`);
    const overallDelta = s2.passRate - s1.passRate;
    console.log(
      `  ${pad(`${BOLD}Overall${RESET}`, COL_CASE)}${pad(pct(s1.passRate), COL_RATE)}${pad(pct(s2.passRate), COL_RATE)}${pad(deltaStr(overallDelta), COL_DELTA)}`,
    );

    // Tool success rate (if both have toolStats)
    if (s1.toolStats && s2.toolStats) {
      const toolDelta = s2.toolStats.successRate - s1.toolStats.successRate;
      console.log(
        `  ${pad("Tool Success Rate", COL_CASE)}${pad(pct(s1.toolStats.successRate), COL_RATE)}${pad(pct(s2.toolStats.successRate), COL_RATE)}${pad(deltaStr(toolDelta), COL_DELTA)}`,
      );
    }

    console.log("");
  });
