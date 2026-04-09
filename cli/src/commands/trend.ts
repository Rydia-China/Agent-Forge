import { Command } from "commander";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { EvalSummary } from "../types.js";

const EVALS_DIR = join(import.meta.dirname, "../../evals");

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const RED_BOLD = "\x1b[1;31m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

function loadAllSummaries(modeFilter?: string): EvalSummary[] {
  let entries: string[];
  try {
    entries = readdirSync(EVALS_DIR);
  } catch {
    return [];
  }

  const summaries: EvalSummary[] = [];
  for (const entry of entries.filter((e) => !e.startsWith(".")).sort()) {
    const summaryPath = join(EVALS_DIR, entry, "summary.json");
    if (!existsSync(summaryPath)) continue;
    try {
      const summary = JSON.parse(readFileSync(summaryPath, "utf-8")) as EvalSummary;
      if (modeFilter && summary.mode !== modeFilter) continue;
      summaries.push(summary);
    } catch {
      // skip malformed
    }
  }
  return summaries;
}

function formatRate(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

function extractDateRange(summaries: EvalSummary[]): string {
  if (summaries.length === 0) return "";
  const first = summaries[0]!.evalId.slice(0, 10);
  const last = summaries[summaries.length - 1]!.evalId.slice(0, 10);
  return first === last ? first : `${first} to ${last}`;
}

interface TrendEntry {
  name: string;
  rates: number[];
  trend: "up" | "down" | "stable";
  regression: boolean;
}

function computeTrend(rates: number[]): "up" | "down" | "stable" {
  if (rates.length < 2) return "stable";
  const first = rates[0]!;
  const last = rates[rates.length - 1]!;
  if (last > first) return "up";
  if (last < first) return "down";
  return "stable";
}

function detectRegression(rates: number[]): boolean {
  const peaked = rates.some((r) => r === 1);
  const current = rates[rates.length - 1]!;
  return peaked && current < 1;
}

function buildTrendData(summaries: EvalSummary[]): TrendEntry[] {
  // Collect all case names across all runs
  const caseRatesMap = new Map<string, (number | null)[]>();
  for (let i = 0; i < summaries.length; i++) {
    for (const c of summaries[i]!.cases) {
      if (!caseRatesMap.has(c.name)) {
        caseRatesMap.set(c.name, new Array(summaries.length).fill(null));
      }
      caseRatesMap.get(c.name)![i] = c.passRate;
    }
  }

  const entries: TrendEntry[] = [];
  for (const [name, rawRates] of caseRatesMap) {
    // Only include runs where this case was present
    const rates = rawRates.filter((r): r is number => r !== null);
    if (rates.length === 0) continue;
    entries.push({
      name,
      rates,
      trend: computeTrend(rates),
      regression: detectRegression(rates),
    });
  }

  // Sort: regressions first, then by name
  entries.sort((a, b) => {
    if (a.regression !== b.regression) return a.regression ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return entries;
}

function computeOverall(summaries: EvalSummary[]): number[] {
  return summaries.map((s) => s.passRate);
}

function trendLabel(t: "up" | "down" | "stable"): string {
  switch (t) {
    case "up":
      return `${GREEN}\u2191 Improving${RESET}`;
    case "down":
      return `${RED}\u2193 Regressing${RESET}`;
    case "stable":
      return `${DIM}\u2192 Stable${RESET}`;
  }
}

export const trendCommand = new Command("trend")
  .description("Show historical trend analysis across eval runs")
  .option("--last <n>", "Number of recent evals to display", parseInt, 10)
  .option("--mode <mode>", "Filter by eval mode (unit, trace, workflow, regression)")
  .action((opts: { last: number; mode?: string }) => {
    const allSummaries = loadAllSummaries(opts.mode);
    if (allSummaries.length === 0) {
      console.log("No eval history found in evals/");
      return;
    }

    const summaries = allSummaries.slice(-opts.last);
    const dateRange = extractDateRange(summaries);
    const entries = buildTrendData(summaries);
    const overall = computeOverall(summaries);
    const overallTrend = computeTrend(overall);

    // Header
    console.log("");
    console.log(`  ${summaries.length} eval run${summaries.length === 1 ? "" : "s"} found (${dateRange})`);
    if (opts.mode) console.log(`  Filtered by mode: ${opts.mode}`);
    console.log("");

    // Calculate column widths
    const nameColWidth = Math.max(
      "Overall".length,
      ...entries.map((e) => e.name.length),
    );
    const padName = (s: string) => s.padEnd(nameColWidth);
    const historyWidth = summaries.length * 6; // "100%  " = 6 chars

    // Table header
    const headerLine = `  ${padName("Case")}  Trend          History`;
    const separator = `  ${"─".repeat(nameColWidth + 2 + 15 + historyWidth + 14)}`;
    console.log(headerLine);
    console.log(separator);

    // Case rows
    for (const entry of entries) {
      const history = entry.rates.map((r) => formatRate(r).padEnd(5)).join(" ");
      const regressionTag = entry.regression ? `  ${RED_BOLD}\u26A0 REGRESSION${RESET}` : "";
      const trend = trendLabel(entry.trend);
      console.log(`  ${padName(entry.name)}  ${trend}    ${history}${regressionTag}`);
    }

    // Separator + overall
    console.log(separator);
    const overallHistory = overall.map((r) => formatRate(r).padEnd(5)).join(" ");
    console.log(`  ${padName("Overall")}  ${trendLabel(overallTrend)}    ${overallHistory}`);
    console.log("");
  });
