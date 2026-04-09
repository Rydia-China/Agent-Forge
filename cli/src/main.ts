import "dotenv/config";
import { Command } from "commander";
import { runCommand } from "./commands/run.js";

const program = new Command();

program
  .name("forge-eval")
  .description("Agent-Forge prompt evaluation CLI")
  .version("0.1.0");

program.addCommand(runCommand);

program.parse();
