export interface CliExecRequest {
  command: string;
  args: string[];
  timeout?: number; // ms, default 30000
  cwd?: string;
  env?: Record<string, string>;
}

export interface CliExecResponse {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

export interface CommandMapping {
  bin: string;
  baseArgs: string[];
  cwd: string;
  description: string;
}

export interface GatewayConfig {
  port: number;
  commands: Record<string, CommandMapping>;
}
