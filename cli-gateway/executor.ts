import { spawn } from "child_process";
import { createInterface } from "readline";
import type { CliExecRequest, CliExecResponse, GatewayConfig } from "./types.js";

const SHELL_INJECTION_PATTERN = /[;|`]|\$\(|&&|\|\|/;

function validateArgs(args: string[]): void {
  for (const arg of args) {
    if (SHELL_INJECTION_PATTERN.test(arg)) {
      throw new Error(`Argument contains disallowed shell characters: ${arg}`);
    }
  }
}

export function execCommand(
  config: GatewayConfig,
  request: CliExecRequest
): Promise<CliExecResponse> {
  const mapping = config.commands[request.command];
  if (!mapping) {
    throw new Error(`Command not allowed: ${request.command}`);
  }

  validateArgs(request.args);

  const fullArgs = [...mapping.baseArgs, ...request.args];
  const timeout = request.timeout ?? 30000;
  const cwd = request.cwd || mapping.cwd;
  const env = { ...process.env, ...request.env };

  return new Promise((resolve, reject) => {
    const start = Date.now();
    const child = spawn(mapping.bin, fullArgs, { cwd, env, timeout });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("error", (err) => {
      reject(err);
    });

    child.on("close", (exitCode) => {
      resolve({
        stdout,
        stderr,
        exitCode: exitCode ?? 1,
        durationMs: Date.now() - start,
      });
    });
  });
}

export function execCommandStream(
  config: GatewayConfig,
  request: CliExecRequest
): ReadableStream<Uint8Array> {
  const mapping = config.commands[request.command];
  if (!mapping) {
    throw new Error(`Command not allowed: ${request.command}`);
  }

  validateArgs(request.args);

  const fullArgs = [...mapping.baseArgs, ...request.args];
  const timeout = request.timeout ?? 30000;
  const cwd = request.cwd || mapping.cwd;
  const env = { ...process.env, ...request.env };
  const encoder = new TextEncoder();

  return new ReadableStream({
    start(controller) {
      const start = Date.now();
      const child = spawn(mapping.bin, fullArgs, { cwd, env, timeout });

      const stdoutRL = createInterface({ input: child.stdout });
      const stderrRL = createInterface({ input: child.stderr });

      stdoutRL.on("line", (line) => {
        const event = `event: stdout\ndata: ${JSON.stringify({ line })}\n\n`;
        controller.enqueue(encoder.encode(event));
      });

      stderrRL.on("line", (line) => {
        const event = `event: stderr\ndata: ${JSON.stringify({ line })}\n\n`;
        controller.enqueue(encoder.encode(event));
      });

      child.on("error", (err) => {
        const event = `event: error\ndata: ${JSON.stringify({ message: err.message })}\n\n`;
        controller.enqueue(encoder.encode(event));
        controller.close();
      });

      child.on("close", (exitCode) => {
        const durationMs = Date.now() - start;
        const event = `event: exit\ndata: ${JSON.stringify({ exitCode: exitCode ?? 1, durationMs })}\n\n`;
        controller.enqueue(encoder.encode(event));
        controller.close();
      });
    },
  });
}

export function listTools(config: GatewayConfig): { name: string; description: string }[] {
  return Object.entries(config.commands).map(([name, mapping]) => ({
    name,
    description: mapping.description,
  }));
}
