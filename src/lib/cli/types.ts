import type { z } from 'zod';

export interface CliCommand {
  name: string;
  description: string;
  schema?: z.ZodType<unknown>;
  handler: (args: unknown) => Promise<void>;
}

export interface CliRegistry {
  commands: Map<string, CliCommand>;
  register: (command: CliCommand) => void;
  execute: (commandName: string, args: unknown) => Promise<void>;
}
