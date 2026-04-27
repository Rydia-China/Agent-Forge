import type { CliCommand, CliRegistry } from './types';

class Registry implements CliRegistry {
  commands = new Map<string, CliCommand>();

  register(command: CliCommand): void {
    if (this.commands.has(command.name)) {
      throw new Error(`Command ${command.name} already registered`);
    }
    this.commands.set(command.name, command);
  }

  async execute(commandName: string, args: unknown): Promise<void> {
    const command = this.commands.get(commandName);
    if (!command) {
      throw new Error(`Command ${commandName} not found`);
    }

    if (command.schema) {
      const validated = command.schema.parse(args);
      await command.handler(validated);
    } else {
      await command.handler(args);
    }
  }

  listCommands(): CliCommand[] {
    return Array.from(this.commands.values());
  }
}

export const registry = new Registry();
