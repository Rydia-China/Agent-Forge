// Import all command modules to register them
import './commands/skills';
import './commands/oss';
import './commands/biz-db';
import './commands/chat';
import './commands/subagent';
import './commands/debug-http';
import './commands/resources';

export { registry } from './registry';
export type { CliCommand, CliRegistry } from './types';
