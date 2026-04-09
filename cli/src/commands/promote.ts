import { Command } from "commander";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CASES_DIR = join(import.meta.dirname, "../../cases");

export const promoteCommand = new Command("promote")
  .description("Graduate a capability case to regression tier")
  .argument("<case>", "Case name to promote")
  .action(async (caseName: string) => {
    const { loadCases } = await import("../eval/loader.js");
    const { cases, files } = loadCases({ filter: caseName });

    if (cases.length === 0) {
      console.log(`Case "${caseName}" not found.`);
      return;
    }

    const evalCase = cases[0]!;
    const caseFile = join(CASES_DIR, files[0]!);

    if (evalCase.tier === "regression") {
      console.log(`Case "${caseName}" is already regression tier.`);
      return;
    }

    const raw = readFileSync(caseFile, "utf-8");
    const updated = raw.replace(/^tier:\s*capability/m, "tier: regression");
    writeFileSync(caseFile, updated);

    console.log(`Promoted "${caseName}" to regression tier.`);
    console.log(`Run with --save-golden to create golden baseline: forge-eval run regression "${caseName}" --save-golden`);
  });
