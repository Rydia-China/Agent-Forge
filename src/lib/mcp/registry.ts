import type { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types";
import {
  type McpProvider,
  type ToolContext,
  qualifyToolName,
  parseToolName,
} from "./types";

/**
 * Callback for auto-loading an MCP provider that isn’t registered yet.
 * Installed once by init.ts after catalog + sandbox are ready.
 */
export type AutoLoadFn = (name: string) => Promise<McpProvider | null>;

/**
 * MCP Registry — global singleton.
 * Aggregates tools from all registered McpProviders (static + dynamic)
 * and dispatches tool calls.
 */
class McpRegistry {
  private providers = new Map<string, McpProvider>();
  private protectedNames = new Set<string>();
  private autoLoad: AutoLoadFn | null = null;
  initialized = false;

  /** Install the auto-load callback (called once during MCP init). */
  setAutoLoad(fn: AutoLoadFn): void {
    this.autoLoad = fn;
  }

  register(provider: McpProvider): void {
    if (this.providers.has(provider.name)) {
      throw new Error(`MCP provider "${provider.name}" already registered`);
    }
    this.providers.set(provider.name, provider);
  }

  /** Mark a provider name as protected (cannot be replaced or unregistered by custom code). */
  protect(name: string): void {
    this.protectedNames.add(name);
  }

  /** Check if a provider name is protected (core or catalog). */
  isProtected(name: string): boolean {
    return this.protectedNames.has(name);
  }

  unregister(name: string): void {
    if (this.protectedNames.has(name)) {
      throw new Error(`Cannot unregister protected MCP provider "${name}"`);
    }
    this.providers.delete(name);
  }

  /** Replace (or register) a provider by name. Cannot replace protected providers. */
  replace(provider: McpProvider): void {
    if (this.protectedNames.has(provider.name)) {
      throw new Error(`Cannot replace protected MCP provider "${provider.name}"`);
    }
    this.providers.set(provider.name, provider);
  }

  getProvider(name: string): McpProvider | undefined {
    return this.providers.get(name);
  }

  listProviders(): McpProvider[] {
    return [...this.providers.values()];
  }

  /**
   * Collect all tools from every provider.
   * Tool names are qualified: `providerName__toolName`.
   */
  async listAllTools(): Promise<Tool[]> {
    const all: Tool[] = [];
    for (const provider of this.providers.values()) {
      const tools = await provider.listTools();
      for (const tool of tools) {
        all.push({
          ...tool,
          name: qualifyToolName(provider.name, tool.name),
        });
      }
    }
    return all;
  }

  /**
   * Collect tools only from the specified providers (scoped).
   * Used by the agent loop to build a domain-specific tool list.
   */
  async listToolsForProviders(names: Iterable<string>): Promise<Tool[]> {
    const all: Tool[] = [];
    for (const name of names) {
      const provider = this.providers.get(name);
      if (!provider) continue;
      const tools = await provider.listTools();
      for (const tool of tools) {
        all.push({
          ...tool,
          name: qualifyToolName(provider.name, tool.name),
        });
      }
    }
    return all;
  }

  /**
   * Dispatch a tool call by its fully-qualified name.
   * If the provider is not registered, attempts auto-load from catalog/DB.
   */
  async callTool(
    fullToolName: string,
    args: Record<string, unknown>,
    context?: ToolContext,
  ): Promise<CallToolResult> {
    const [providerName, toolName] = parseToolName(fullToolName);
    let provider = this.providers.get(providerName);

    // Auto-load: try catalog / dynamic MCP on first access
    if (!provider && this.autoLoad) {
      try {
        const loaded = await this.autoLoad(providerName);
        if (loaded) {
          this.providers.set(providerName, loaded);
          provider = loaded;
        }
      } catch (err) {
        console.warn(`[registry] auto-load "${providerName}" failed:`, err);
      }
    }

    if (!provider) {
      return {
        content: [{ type: "text", text: `Unknown MCP provider: ${providerName}` }],
        isError: true,
      };
    }
    try {
      return await provider.callTool(toolName, args, context);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Tool error: ${message}` }],
        isError: true,
      };
    }
  }
}

// Global singleton (survives HMR in Next.js dev)
const globalForRegistry = globalThis as unknown as {
  mcpRegistry: McpRegistry | undefined;
};

export const registry =
  globalForRegistry.mcpRegistry ?? new McpRegistry();

globalForRegistry.mcpRegistry = registry;
