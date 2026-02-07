import type { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types";

export type { Tool, CallToolResult };

/**
 * Internal provider interface — each static/dynamic MCP implements this.
 * Registry aggregates all providers and dispatches tool calls.
 */
export interface McpProvider {
  /** Unique provider name, used as tool namespace prefix (e.g. "skills") */
  readonly name: string;
  listTools(): Promise<Tool[]>;
  callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<CallToolResult>;
}

/** Separator between provider name and tool name */
export const TOOL_NS_SEP = "__";

/** Build a fully-qualified tool name: `providerName__toolName` */
export function qualifyToolName(provider: string, tool: string): string {
  return `${provider}${TOOL_NS_SEP}${tool}`;
}

/** Split a fully-qualified tool name into [providerName, toolName] */
export function parseToolName(
  fullName: string,
): [provider: string, tool: string] {
  const idx = fullName.indexOf(TOOL_NS_SEP);
  if (idx === -1) return ["", fullName];
  return [fullName.slice(0, idx), fullName.slice(idx + TOOL_NS_SEP.length)];
}
