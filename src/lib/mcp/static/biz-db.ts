import type { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types";
import type { McpProvider } from "../types";
import { bizPool } from "@/lib/biz-db";
import { guardQuery, guardExecute } from "@/lib/sql-guard";

function text(t: string): CallToolResult {
  return { content: [{ type: "text", text: t }] };
}

function json(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

export const bizDbMcp: McpProvider = {
  name: "biz_db",

  async listTools(): Promise<Tool[]> {
    return [
      {
        name: "list_tables",
        description:
          "List all tables in the business database (XTDB).",
        inputSchema: { type: "object" as const, properties: {} },
      },
      {
        name: "describe_table",
        description:
          "Show the column names and inferred data types of a table.",
        inputSchema: {
          type: "object" as const,
          properties: {
            table: {
              type: "string",
              description: "Table name",
            },
          },
          required: ["table"],
        },
      },
      {
        name: "query",
        description:
          "Run a read-only SQL query (SELECT) and return results as JSON rows.",
        inputSchema: {
          type: "object" as const,
          properties: {
            sql: {
              type: "string",
              description: "SQL SELECT statement",
            },
          },
          required: ["sql"],
        },
      },
      {
        name: "execute",
        description:
          "Execute a SQL statement (INSERT, UPDATE, DELETE, etc.) on the XTDB immutable database. Tables are created automatically on first INSERT — no CREATE TABLE needed.",
        inputSchema: {
          type: "object" as const,
          properties: {
            sql: {
              type: "string",
              description: "SQL statement to execute",
            },
          },
          required: ["sql"],
        },
      },
    ];
  },

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<CallToolResult> {
    switch (name) {
      case "list_tables": {
        const result = await bizPool.query(`
          SELECT table_name
          FROM information_schema.tables
          WHERE table_schema = 'public'
          ORDER BY table_name
        `);
        if (result.rows.length === 0) return text("No tables in business database.");
        return json(result.rows);
      }

      case "describe_table": {
        const table = String(args.table);

        const colResult = await bizPool.query(
          `SELECT
            column_name,
            data_type,
            is_nullable
          FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1
          ORDER BY ordinal_position`,
          [table],
        );

        if (colResult.rows.length === 0) {
          return text(`Table "${table}" not found.`);
        }

        return json({
          table,
          columns: colResult.rows,
        });
      }

      case "query": {
        const sql = String(args.sql);
        const check = guardQuery(sql);
        if (!check.ok) return text(check.reason);
        const result = await bizPool.query(sql);
        return json({ rows: result.rows, rowCount: result.rowCount });
      }

      case "execute": {
        const sql = String(args.sql);
        const check = guardExecute(sql);
        if (!check.ok) return text(check.reason);
        const result = await bizPool.query(sql);
        return text(`OK — ${result.rowCount ?? 0} row(s) affected. Command: ${result.command}`);
      }

      default:
        return text(`Unknown tool: ${name}`);
    }
  },
};
