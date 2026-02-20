import type { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types";
import type { McpProvider } from "../types";
import { recallToolResult } from "@/lib/services/chat-session-service";
import { getCurrentSessionId } from "@/lib/request-context";

function text(t: string): CallToolResult {
  return { content: [{ type: "text", text: t }] };
}

export const memoryMcp: McpProvider = {
  name: "memory",

  async listTools(): Promise<Tool[]> {
    return [
      {
        name: "recall",
        description:
          "Recall the full original content of one or more previous tool calls whose " +
          "results were compressed into [memory] summaries. Use the recall IDs shown " +
          "in memory entries (the value after 'recall:'). Supports batch recall to " +
          "reduce round-trips.",
        inputSchema: {
          type: "object" as const,
          properties: {
            id: {
              type: "string",
              description:
                "A single tool call ID to recall (the value after 'recall:' in memory entries)",
            },
            ids: {
              type: "array",
              items: { type: "string" },
              description:
                "Multiple tool call IDs to recall in one call. Use this instead of 'id' when recalling several results at once.",
            },
          },
        },
      },
    ];
  },

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<CallToolResult> {
    if (name !== "recall") return text(`Unknown tool: ${name}`);

    const sessionId = getCurrentSessionId();
    if (!sessionId) {
      return text("Cannot recall: no active session context");
    }

    // Collect IDs from either `id` (single) or `ids` (batch)
    const idList: string[] = [];
    if (typeof args.id === "string" && args.id) idList.push(args.id);
    if (Array.isArray(args.ids)) {
      for (const v of args.ids) {
        if (typeof v === "string" && v) idList.push(v);
      }
    }
    if (idList.length === 0) return text("Missing recall ID(s)");

    // Single recall — simple path
    if (idList.length === 1) {
      const content = await recallToolResult(sessionId, idList[0]!);
      if (content === null) {
        return text(`No stored content for recall ID: ${idList[0]}`);
      }
      return text(content);
    }

    // Batch recall
    const results = await Promise.all(
      idList.map(async (rid) => {
        const content = await recallToolResult(sessionId, rid);
        return { id: rid, content };
      }),
    );

    const parts = results.map(({ id: rid, content }) =>
      content !== null
        ? `=== recall:${rid} ===\n${content}`
        : `=== recall:${rid} ===\n[not found]`,
    );
    return text(parts.join("\n\n"));
  },
};
