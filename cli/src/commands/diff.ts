import { Command } from "commander";
import { createDiff, saveDiff, showDiff, listDiffs, revertDiff, verifyDiff } from "../optimize/diff-manager.js";

export const diffCommand = new Command("diff")
  .description("Manage prompt optimization diffs");

diffCommand
  .command("create <name> <files...>")
  .description("Snapshot files for optimization tracking")
  .action((name: string, files: string[]) => {
    const metadata = createDiff(name, "", files);
    console.log(`Created diff: ${metadata.id}`);
    console.log(`Snapshotted ${files.length} file(s). Make your changes, then run: forge-eval diff save ${name}`);
  });

diffCommand
  .command("save <name>")
  .description("Generate diff from snapshot vs current state")
  .action((name: string) => {
    saveDiff(name);
    console.log(`Diff saved: ${name}`);
  });

diffCommand
  .command("show <name>")
  .description("Display diff content")
  .action((name: string) => {
    console.log(showDiff(name));
  });

diffCommand
  .command("list")
  .description("List all diffs")
  .action(() => {
    const diffs = listDiffs();
    if (diffs.length === 0) {
      console.log("No diffs found.");
      return;
    }
    for (const d of diffs) {
      const icon = d.status === "applied" ? "\u2713" : d.status === "reverted" ? "\u21A9" : "\u25CB";
      console.log(`  ${icon} ${d.id} [${d.status}] \u2014 ${d.description || "(no description)"}`);
    }
  });

diffCommand
  .command("revert <name>")
  .description("Restore files from before/ snapshots")
  .action((name: string) => {
    revertDiff(name);
    console.log(`Reverted: ${name}`);
  });

diffCommand
  .command("verify <name>")
  .description("Record eval results for a diff")
  .requiredOption("--eval <eval-id>", "Eval ID to compare against")
  .action((name: string, opts: { eval: string }) => {
    verifyDiff(name, opts.eval);
    console.log(`Verified: ${name} against eval ${opts.eval}`);
  });
