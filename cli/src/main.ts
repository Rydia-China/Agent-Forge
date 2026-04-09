import "dotenv/config";
import { Command } from "commander";
import { runCommand } from "./commands/run.js";
import { reportCommand } from "./commands/report.js";
import { promoteCommand } from "./commands/promote.js";
import { diffCommand } from "./commands/diff.js";
import { compareCommand } from "./commands/compare.js";
import { trendCommand } from "./commands/trend.js";

const program = new Command();

program
  .name("forge-eval")
  .description("Agent-Forge prompt evaluation CLI")
  .version("0.1.0");

program.addCommand(runCommand);
program.addCommand(reportCommand);
program.addCommand(promoteCommand);
program.addCommand(diffCommand);
program.addCommand(compareCommand);
program.addCommand(trendCommand);

program.parse();
