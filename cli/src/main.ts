import "dotenv/config";
import { Command } from "commander";

const program = new Command();

program
  .name("forge-eval")
  .description("Agent-Forge prompt evaluation CLI")
  .version("0.1.0");

// Commands will be added as they are implemented
// program.addCommand(runCommand);
// program.addCommand(reportCommand);
// program.addCommand(diffCommand);
// program.addCommand(promoteCommand);

program.parse();
