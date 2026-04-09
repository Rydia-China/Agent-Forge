import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { parse as parseYaml } from "yaml";
import type { EvalCase, CaseMode } from "../types.js";

const CASES_DIR = join(import.meta.dirname, "../../cases");

/** Parse a single YAML case file into an EvalCase. */
export function loadCase(filePath: string): EvalCase {
  const raw = readFileSync(filePath, "utf-8");
  const parsed = parseYaml(raw) as Record<string, unknown>;

  return {
    name: (parsed.name as string) ?? "",
    description: (parsed.description as string) ?? "",
    mode: (parsed.mode as CaseMode) ?? "unit",
    tags: (parsed.tags as string[]) ?? [],
    tier: (parsed.tier as "capability" | "regression") ?? "capability",
    runs: (parsed.runs as number) ?? 3,
    input: parsed.input as EvalCase["input"],
    context: parsed.context as EvalCase["context"],
    steps: parsed.steps as EvalCase["steps"],
    expected_tools: parsed.expected_tools as EvalCase["expected_tools"],
    golden: parsed.golden as string | undefined,
    tolerance: parsed.tolerance as EvalCase["tolerance"],
    assertions: parsed.assertions as EvalCase["assertions"],
  };
}

/** Recursively find all .yaml/.yml files under a directory. */
function findYamlFiles(dir: string): string[] {
  const results: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    const stat = statSync(full, { throwIfNoEntry: false });
    if (!stat) continue;
    if (stat.isDirectory()) {
      if (entry === "golden") continue;
      results.push(...findYamlFiles(full));
    } else if (entry.endsWith(".yaml") || entry.endsWith(".yml")) {
      results.push(full);
    }
  }
  return results;
}

export interface LoadOptions {
  mode?: CaseMode;
  filter?: string;
  tags?: string[];
  tier?: "capability" | "regression";
}

/** Load all cases matching the given options. */
export function loadCases(opts: LoadOptions): { cases: EvalCase[]; files: string[] } {
  const allFiles = findYamlFiles(CASES_DIR);
  const cases: EvalCase[] = [];
  const files: string[] = [];

  for (const file of allFiles) {
    const c = loadCase(file);
    if (opts.mode && c.mode !== opts.mode) continue;
    if (opts.filter) {
      const pattern = opts.filter.replace(/\*/g, ".*");
      if (!new RegExp(`^${pattern}$`).test(c.name)) continue;
    }
    if (opts.tags?.length) {
      if (!opts.tags.every((t) => c.tags.includes(t))) continue;
    }
    if (opts.tier && c.tier !== opts.tier) continue;
    cases.push(c);
    files.push(relative(CASES_DIR, file));
  }

  return { cases, files };
}
