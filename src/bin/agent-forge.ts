#!/usr/bin/env node
import { registry } from '../lib/cli';

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log('Agent Forge CLI\n');
    console.log('Usage: agent-forge <command> <json-args>\n');
    console.log('Available commands:');
    const commands = registry.listCommands();
    for (const cmd of commands) {
      console.log(`  ${cmd.name.padEnd(30)} ${cmd.description}`);
    }
    process.exit(0);
  }

  const commandName = args[0];
  if (!commandName) {
    console.error('Error: Command name is required');
    process.exit(1);
  }

  const jsonArgs = args[1] || '{}';

  try {
    const parsedArgs = JSON.parse(jsonArgs);
    await registry.execute(commandName, parsedArgs);
  } catch (error) {
    if (error instanceof Error) {
      console.error('Error:', error.message);
      if (error.stack) {
        console.error(error.stack);
      }
    } else {
      console.error('Error:', String(error));
    }
    process.exit(1);
  }
}

main();
