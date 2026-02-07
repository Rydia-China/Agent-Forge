import ivm from "isolated-vm";
import type { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types";
import type { McpProvider } from "./types";
import { prisma } from "@/lib/db";

/* ------------------------------------------------------------------ */
/*  Wrapper code injected around user JS                              */
/* ------------------------------------------------------------------ */

const WRAPPER_PREFIX = `
const module = { exports: {} };
const exports = module.exports;
const bridge = {
  log: (...args) => __bridge_log(args.map(String).join(' ')),
  fetch: async (url, options) => {
    const raw = await __bridge_fetch(url, JSON.stringify(options || {}));
    return JSON.parse(raw);
  },
  getSkill: async (name) => __bridge_getSkill(name),
};
`;

const WRAPPER_SUFFIX = `
globalThis.__mcp_exports = module.exports;
`;

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

interface SandboxInstance {
  isolate: ivm.Isolate;
  context: ivm.Context;
  name: string;
}

/* ------------------------------------------------------------------ */
/*  SandboxManager                                                    */
/* ------------------------------------------------------------------ */

export class SandboxManager {
  private instances = new Map<string, SandboxInstance>();
  private memoryLimitMb: number;
  private timeoutMs: number;

  constructor(opts?: { memoryLimitMb?: number; timeoutMs?: number }) {
    this.memoryLimitMb = opts?.memoryLimitMb ?? 128;
    this.timeoutMs = opts?.timeoutMs ?? 30_000;
  }

  /* ---------- load / unload ---------------------------------------- */

  /**
   * Load JS code into a new isolate and return an McpProvider.
   * If already loaded, the old instance is disposed first.
   */
  async load(name: string, code: string): Promise<McpProvider> {
    this.unload(name);

    const isolate = new ivm.Isolate({ memoryLimit: this.memoryLimitMb });
    const context = await isolate.createContext();
    const jail = context.global;

    // self-reference
    await jail.set("global", jail.derefInto());

    // --- bridge functions ---
    await jail.set(
      "__bridge_log",
      new ivm.Callback((msg: string) => {
        console.log(`[sandbox:${name}]`, msg);
      }),
    );

    await jail.set(
      "__bridge_fetch",
      new ivm.Callback(
        async (url: string, optionsJson: string) => {
          try {
            const opts = JSON.parse(optionsJson);
            const resp = await fetch(url, opts);
            const body = await resp.text();
            return JSON.stringify({
              status: resp.status,
              body,
            });
          } catch (err: unknown) {
            return JSON.stringify({
              status: 0,
              body: err instanceof Error ? err.message : String(err),
            });
          }
        },
        { async: true },
      ),
    );

    await jail.set(
      "__bridge_getSkill",
      new ivm.Callback(
        async (skillName: string) => {
          const skill = await prisma.skill.findUnique({
            where: { name: skillName },
          });
          return skill?.content ?? null;
        },
        { async: true },
      ),
    );

    // --- compile & run user code ---
    const wrappedCode = WRAPPER_PREFIX + code + WRAPPER_SUFFIX;
    const script = await isolate.compileScript(wrappedCode, {
      filename: `mcp:${name}`,
    });
    await script.run(context, { timeout: this.timeoutMs });
    script.release();

    this.instances.set(name, { isolate, context, name });

    return this.createProvider(name);
  }

  /** Dispose an isolate and remove it from the map. */
  unload(name: string): void {
    const inst = this.instances.get(name);
    if (!inst) return;
    try {
      if (!inst.isolate.isDisposed) {
        inst.context.release();
        inst.isolate.dispose();
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
    const self = this;
    return {
      name: mcpName,

      async listTools(): Promise<Tool[]> {
        const inst = self.instances.get(mcpName);
        if (!inst) throw new Error(`Sandbox "${mcpName}" not loaded`);
        const tools = await inst.context.evalClosure(
          "return globalThis.__mcp_exports.tools || [];",
          [],
          { result: { copy: true }, timeout: 5_000 },
        );
        return tools as Tool[];
      },

      async callTool(
        toolName: string,
        args: Record<string, unknown>,
      ): Promise<CallToolResult> {
        const inst = self.instances.get(mcpName);
        if (!inst) throw new Error(`Sandbox "${mcpName}" not loaded`);

        const result = await inst.context.evalClosure(
          "return globalThis.__mcp_exports.callTool($0, $1);",
          [toolName, new ivm.ExternalCopy(args).copyInto()],
          {
            result: { copy: true, promise: true },
            timeout: self.timeoutMs,
          },
        );

        // Normalise: if user returned a plain string, wrap it
        if (typeof result === "string") {
          return { content: [{ type: "text", text: result }] };
        }
        return result as CallToolResult;
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
