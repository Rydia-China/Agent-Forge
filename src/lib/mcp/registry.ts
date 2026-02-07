import type { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types";
import {
  type McpProvider,
  qualifyToolName,
  parseToolName,
} from "./types";

/**
 * MCP Registry — global singleton.
 * Aggregates tools from all registered McpProviders (static + dynamic)
 * and dispatches tool calls.
 */
class McpRegistry {
  private providers = new Map<string, McpProvider>();
  initialized = false;

  register(provider: McpProvider): void {
    if (this.providers.has(provider.name)) {
      throw new Error(`MCP provider "${provider.name}" already registered`);
    }
    this.providers.set(provider.name, provider);
  }

  unregister(name: string): void {
    this.providers.delete(name);
  }

  /** Replace (or register) a provider by name */
  replace(provider: McpProvider): void {
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
   * Dispatch a tool call by its fully-qualified name.
   */
  async callTool(
    fullToolName: string,
    args: Record<string, unknown>,
  ): Promise<CallToolResult> {
    const [providerName, toolName] = parseToolName(fullToolName);
    const provider = this.providers.get(providerName);
    if (!provider) {
      return {
        content: [{ type: "text", text: `Unknown MCP provider: ${providerName}` }],
        isError: true,
      };
    }
    try {
      return await provider.callTool(toolName, args);
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
