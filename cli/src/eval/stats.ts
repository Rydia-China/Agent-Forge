import type { CaseStats, AssertionResult, JudgeResult, Trace, ConsistencyAssertion } from "../types.js";

function mean(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function stdDev(nums: number[]): number {
  if (nums.length < 2) return 0;
  const m = mean(nums);
  const variance = nums.reduce((sum, n) => sum + (n - m) ** 2, 0) / (nums.length - 1);
  return Math.sqrt(variance);
}

function resolveStatsPath(obj: unknown, path: string): number[] {
  if (path.endsWith(".length")) {
    const basePath = path.slice(0, -7);
    const val = resolveSimplePath(obj, basePath);
    if (Array.isArray(val)) return [val.length];
    return [];
  }
  if (path.includes("[*]")) {
    const [arrPath, ...rest] = path.split("[*].");
    const arr = resolveSimplePath(obj, arrPath!);
    if (!Array.isArray(arr)) return [];
    return arr.map((item) => {
      const val = resolveSimplePath(item, rest.join("[*]."));
      return typeof val === "number" ? val : typeof val === "string" ? val.length : 0;
    });
  }
  const val = resolveSimplePath(obj, path);
  return typeof val === "number" ? [val] : [];
}

function resolveSimplePath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  const parts = path.replace(/\[(\d+)\]/g, ".$1").split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export interface RunResult {
  trace: Trace;
  assertions: AssertionResult[];
  judgeResult?: JudgeResult;
}

export function computeStats(runs: RunResult[], consistencyAssertions?: ConsistencyAssertion[]): CaseStats {
  const n = runs.length;
  const passCounts = runs.filter((r) => r.assertions.every((a) => a.pass)).length;
  const passRate = n > 0 ? passCounts / n : 0;

  const passAtK = 1 - Math.pow(1 - passRate, n);
  const passExpK = Math.pow(passRate, n);

  const scores = runs.map((r) => r.judgeResult?.score).filter((s): s is number => s != null && s > 0);
  const semanticScores = scores.length > 0
    ? {
        mean: mean(scores),
        stdDev: stdDev(scores),
        min: Math.min(...scores),
        max: Math.max(...scores),
        distribution: scores.reduce<Record<number, number>>((acc, s) => {
          acc[s] = (acc[s] ?? 0) + 1;
          return acc;
        }, {}),
      }
    : undefined;

  let consistency: Record<string, { mean: number; stdDev: number; pass: boolean }> | undefined;
  if (consistencyAssertions?.length) {
    consistency = {};
    for (const ca of consistencyAssertions) {
      const allValues: number[] = [];
      for (const run of runs) {
        const parsed = run.trace.unitResult?.parsed;
        if (parsed == null) continue;
        allValues.push(...resolveStatsPath(parsed, ca.path));
      }
      const m = mean(allValues);
      const sd = stdDev(allValues);
      let pass = true;
      if (ca.max_std_dev != null && sd > ca.max_std_dev) pass = false;
      if (ca.min_avg_length != null && m < ca.min_avg_length) pass = false;
      consistency[ca.path] = { mean: m, stdDev: sd, pass };
    }
  }

  const durations = runs.map((r) => r.trace.totalDurationMs);
  const timing = {
    mean: mean(durations),
    min: durations.length > 0 ? Math.min(...durations) : 0,
    max: durations.length > 0 ? Math.max(...durations) : 0,
  };

  return { runs: n, passRate, passAtK, passExpK, semanticScores, consistency, timing };
}
