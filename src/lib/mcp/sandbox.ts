import { newAsyncContext, type QuickJSAsyncContext, type QuickJSHandle } from "quickjs-emscripten";
import type { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types";
import type { McpProvider } from "./types";
import { prisma } from "@/lib/db";

/* ------------------------------------------------------------------ */
/*  Wrapper code injected around user JS                              */
/* ------------------------------------------------------------------ */

const WRAPPER_PREFIX = `
const module = { exports: {} };
const exports = module.exports;

var console = {
  log:   (...a) => __bridge_log(a.map(String).join(' ')),
  warn:  (...a) => __bridge_log(a.map(String).join(' ')),
  error: (...a) => __bridge_log(a.map(String).join(' ')),
};

function fetch(url, options) {
  var raw = __bridge_fetch(url, JSON.stringify(options || {}));
  var r = JSON.parse(raw);
  r.ok   = r.status >= 200 && r.status < 300;
  r.json = function() { return JSON.parse(this.body); };
  r.text = function() { return this.body; };
  return r;
}

function getSkill(name) {
  return __bridge_getSkill(name);
}
`;

const WRAPPER_SUFFIX = `
globalThis.__mcp_exports = module.exports;
`;

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

interface SandboxInstance {
  context: QuickJSAsyncContext;
  name: string;
  /** Mutable deadline (epoch ms) for the interrupt handler. */
  deadline: number;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/** Set a global property from a handle, disposing the handle after. */
function setGlobal(ctx: QuickJSAsyncContext, name: string, handle: QuickJSHandle): void {
  ctx.setProp(ctx.global, name, handle);
  handle.dispose();
}

/* ------------------------------------------------------------------ */
/*  SandboxManager                                                    */
/* ------------------------------------------------------------------ */

export class SandboxManager {
  private instances = new Map<string, SandboxInstance>();
  private memoryLimitBytes: number;
  private timeoutMs: number;

  constructor(opts?: { memoryLimitMb?: number; timeoutMs?: number }) {
    this.memoryLimitBytes = (opts?.memoryLimitMb ?? 128) * 1024 * 1024;
    this.timeoutMs = opts?.timeoutMs ?? 30_000;
  }

  /* ---------- load / unload ---------------------------------------- */

  /**
   * Load JS code into a new QuickJS sandbox and return an McpProvider.
   * Each sandbox gets its own WASM module (via newAsyncContext) so that
   * asyncified host functions in different sandboxes are independent.
   */
  async load(name: string, code: string): Promise<McpProvider> {
    this.unload(name);

    const context = await newAsyncContext();
    const runtime = context.runtime;

    runtime.setMemoryLimit(this.memoryLimitBytes);
    runtime.setMaxStackSize(1024 * 1024); // 1 MB stack

    const inst: SandboxInstance = { context, name, deadline: Infinity };

    // Interrupt handler: checked periodically by QuickJS during execution
    runtime.setInterruptHandler(() => Date.now() > inst.deadline);

    // --- bridge functions ---

    setGlobal(
      context,
      "__bridge_log",
      context.newFunction("__bridge_log", (msgHandle) => {
        const msg = context.getString(msgHandle);
        console.log(`[sandbox:${name}]`, msg);
      }),
    );

    // bridge.fetch — asyncified: suspends WASM while host fetch() resolves
    setGlobal(
      context,
      "__bridge_fetch",
      context.newAsyncifiedFunction(
        "__bridge_fetch",
        async (urlHandle, optionsJsonHandle) => {
          const url = context.getString(urlHandle);
          const optionsJson = context.getString(optionsJsonHandle);
          const opts: RequestInit = JSON.parse(optionsJson);

          try {
            const resp = await fetch(url, opts);
            const body = await resp.text();
            return context.newString(
              JSON.stringify({ status: resp.status, body }),
            );
          } catch (err: unknown) {
            return context.newString(
              JSON.stringify({
                status: 0,
                body: err instanceof Error ? err.message : String(err),
              }),
            );
          }
        },
      ),
    );

    // bridge.getSkill — asyncified (returns production version content)
    setGlobal(
      context,
      "__bridge_getSkill",
      context.newAsyncifiedFunction(
        "__bridge_getSkill",
        async (nameHandle) => {
          const skillName = context.getString(nameHandle);
          const skill = await prisma.skill.findUnique({
            where: { name: skillName },
          });
          if (!skill) return context.null;

          const ver = await prisma.skillVersion.findUnique({
            where: {
              skillId_version: {
                skillId: skill.id,
                version: skill.productionVersion,
              },
            },
          });
          if (ver?.content != null) {
            return context.newString(ver.content);
          }
          return context.null;
        },
      ),
    );

    // --- compile & run user code ---

    const wrappedCode = WRAPPER_PREFIX + code + WRAPPER_SUFFIX;

    inst.deadline = Date.now() + this.timeoutMs;
    const result = context.evalCode(wrappedCode, `mcp:${name}`);
    inst.deadline = Infinity;

    if (result.error) {
      const err: unknown = context.dump(result.error);
      result.error.dispose();
      context.dispose();
      runtime.dispose();
      throw new Error(
        `Failed to load sandbox "${name}": ${String(err)}`,
      );
    }
    result.value.dispose();

    this.instances.set(name, inst);
    return this.createProvider(name);
  }

  /** Dispose a sandbox and remove it from the map. */
  unload(name: string): void {
    const inst = this.instances.get(name);
    if (!inst) return;
    try {
      if (inst.context.alive) {
        inst.context.dispose();
        inst.context.runtime.dispose();
      }
    } catch {
      /* already disposed */
    }
    this.instances.delete(name);
  }

  /** Dispose every sandbox. */
  disposeAll(): void {
    for (const name of [...this.instances.keys()]) {
      this.unload(name);
    }
  }

  isLoaded(name: string): boolean {
    return this.instances.has(name);
  }

  /* ---------- provider factory -------------------------------------- */

  private createProvider(mcpName: string): McpProvider {
    return {
      name: mcpName,

      listTools: async (): Promise<Tool[]> => {
        const inst = this.instances.get(mcpName);
        if (!inst) throw new Error(`Sandbox "${mcpName}" not loaded`);

        inst.deadline = Date.now() + 5_000;
        const result = inst.context.evalCode(
          "JSON.stringify(globalThis.__mcp_exports.tools || [])",
        );
        inst.deadline = Infinity;

        if (result.error) {
          const err: unknown = inst.context.dump(result.error);
          result.error.dispose();
          throw new Error(`listTools failed: ${String(err)}`);
        }
        const json = inst.context.getString(result.value);
        result.value.dispose();
        return JSON.parse(json) as Tool[];
      },

      callTool: async (
        toolName: string,
        args: Record<string, unknown>,
      ): Promise<CallToolResult> => {
        const inst = this.instances.get(mcpName);
        if (!inst) throw new Error(`Sandbox "${mcpName}" not loaded`);

        const argsJson = JSON.stringify(args);

        // evalCodeAsync handles asyncified bridge functions.
        // callTool may be sync or async; we detect Promises and
        // pump the microtask queue with executePendingJobs() as a
        // fallback for async callTool.
        inst.deadline = Date.now() + this.timeoutMs;
        const result = await inst.context.evalCodeAsync(
          `(function() {
            var __args = JSON.parse(${JSON.stringify(argsJson)});
            var __r = globalThis.__mcp_exports.callTool(
              ${JSON.stringify(toolName)}, __args
            );
            if (__r && typeof __r.then === 'function') {
              globalThis.__callToolOk = undefined;
              globalThis.__callToolErr = undefined;
              __r.then(function(v) { globalThis.__callToolOk = JSON.stringify(v); })
                .catch(function(e) { globalThis.__callToolErr = String(e); });
              return null;
            }
            return JSON.stringify(__r);
          })()`,
          `mcp:${mcpName}:callTool`,
        );
        inst.deadline = Infinity;

        if (result.error) {
          const err: unknown = inst.context.dump(result.error);
          result.error.dispose();
          throw new Error(`callTool("${toolName}") failed: ${String(err)}`);
        }

        const raw: unknown = inst.context.dump(result.value);
        result.value.dispose();

        let json: string;
        if (raw === null) {
          // callTool returned a Promise — resolve via microtask queue
          inst.context.runtime.executePendingJobs();

          const readResult = inst.context.evalCode(
            `globalThis.__callToolErr || globalThis.__callToolOk`,
          );
          if (readResult.error) {
            const err: unknown = inst.context.dump(readResult.error);
            readResult.error.dispose();
            throw new Error(`callTool("${toolName}") async resolution failed: ${String(err)}`);
          }
          const resolved = inst.context.getString(readResult.value);
          readResult.value.dispose();

          // Check if it was an error
          const errCheck = inst.context.evalCode(`globalThis.__callToolErr`);
          if (errCheck.error) {
            errCheck.error.dispose();
          } else {
            const errVal: unknown = inst.context.dump(errCheck.value);
            errCheck.value.dispose();
            if (typeof errVal === "string") {
              throw new Error(errVal);
            }
          }

          json = resolved;
        } else {
          json = String(raw);
        }

        const parsed: unknown = JSON.parse(json);

        // Normalise: if user returned a plain string, wrap it
        if (typeof parsed === "string") {
          return { content: [{ type: "text", text: parsed }] };
        }
        return parsed as CallToolResult;
      },
    };
  }
}

/* ------------------------------------------------------------------ */
/*  Global singleton (survives Next.js HMR)                           */
/* ------------------------------------------------------------------ */

const g = globalThis as unknown as { __sandboxManager?: SandboxManager };
export const sandboxManager = g.__sandboxManager ?? new SandboxManager();
g.__sandboxManager = sandboxManager;
