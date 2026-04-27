import type { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types";
import type { McpProvider, ToolContext } from "../types";
import { bizPool } from "@/lib/biz-db";
import { guardQuery, guardExecute } from "@/lib/sql-guard";
import {
  listVisibleTables,
  resolveTable,
  buildRewriteMap,
  applySqlRewrite,
  upgradeToGlobal,
  GLOBAL_USER,
} from "@/lib/biz-db-namespace";
import * as schemaSvc from "@/lib/services/biz-schema-service";

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
          "列出业务数据库中的所有表。包括你的表和全局表。",
        inputSchema: { type: "object" as const, properties: {} },
      },
      {
        name: "describe_table",
        description:
          "查看表的列名和数据类型。传入表名数组，单个表也需要用数组格式。",
        inputSchema: {
          type: "object" as const,
          properties: {
            tables: {
              type: "array",
              items: { type: "string" },
              description: "要查询的表名数组",
            },
          },
          required: ["tables"],
        },
      },
      {
        name: "sql",
        description:
          "执行 DML SQL 语句。查询（SELECT/WITH）返回 JSON 行，写入（INSERT/UPDATE/DELETE/TRUNCATE）返回影响行数。禁止使用 DDL 语句，请改用 create_table/alter_table/drop_table。",
        inputSchema: {
          type: "object" as const,
          properties: {
            sql: {
              type: "string",
              description: "SQL 语句（仅限 DML）",
            },
          },
          required: ["sql"],
        },
      },
      {
        name: "upgrade_global",
        description:
          "将用户表升级为全局表，所有用户可见。此操作不可逆。首次调用会列出关联表，需确认后再次调用。",
        inputSchema: {
          type: "object" as const,
          properties: {
            table: {
              type: "string",
              description: "要升级的逻辑表名",
            },
            confirm: {
              type: "boolean",
              description: "设为 true 确认升级。首次调用省略此参数以查看关联表",
            },
            include_related: {
              type: "array",
              items: { type: "string" },
              description: "要一并升级的关联表名（从首次调用返回的列表中选择）",
            },
          },
          required: ["table"],
        },
      },
      {
        name: "list_global_tables",
        description: "列出所有全局表（不限定用户范围）。",
        inputSchema: { type: "object" as const, properties: {} },
      },
      /* ---------- schema management ---------- */
      {
        name: "create_table",
        description:
          "声明式创建表。Schema 自动版本化，DDL 自动生成。这是创建表的唯一方式。",
        inputSchema: {
          type: "object" as const,
          properties: {
            tableName: { type: "string", description: "逻辑表名" },
            columns: {
              type: "array",
              description: "列定义",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  type: { type: "string", description: "PostgreSQL 类型：text, integer, serial, boolean, timestamp, jsonb 等" },
                  nullable: { type: "boolean", description: "默认：true" },
                  default: { type: "string", description: "原始 SQL 默认值表达式" },
                },
                required: ["name", "type"],
              },
            },
            constraints: {
              type: "array",
              description: "可选的表约束",
              items: {
                type: "object",
                properties: {
                  type: { type: "string", description: "\"pk\" 或 \"unique\"" },
                  columns: { type: "array", items: { type: "string" } },
                },
                required: ["type", "columns"],
              },
            },
            description: { type: "string", description: "表的可读描述" },
            global: { type: "boolean", description: "创建为全局表（所有用户可见）。默认：false（用户范围）" },
          },
          required: ["tableName", "columns"],
        },
      },
      {
        name: "alter_table",
        description:
          "声明式修改表结构。提供操作列表（add_column, drop_column, alter_column, add_constraint）。Schema 版本自动递增。",
        inputSchema: {
          type: "object" as const,
          properties: {
            tableName: { type: "string", description: "逻辑表名" },
            actions: {
              type: "array",
              description: "要执行的修改操作",
              items: {
                type: "object",
                properties: {
                  action: { type: "string", description: "\"add_column\" | \"drop_column\" | \"alter_column\" | \"add_constraint\"" },
                  column: { type: "object", description: "add_column 用：{ name, type, nullable?, default? }" },
                  name: { type: "string", description: "drop_column / alter_column 用：列名" },
                  type: { type: "string", description: "alter_column 用：新类型" },
                  nullable: { type: "boolean", description: "alter_column 用：新的可空性" },
                  default: { type: "string", description: "alter_column 用：新默认值（null 表示删除）" },
                  constraint: { type: "object", description: "add_constraint 用：{ type, columns }" },
                },
                required: ["action"],
              },
            },
            description: { type: "string", description: "本次变更的描述" },
          },
          required: ["tableName", "actions"],
        },
      },
      {
        name: "drop_table",
        description: "删除表及其 schema 注册记录。",
        inputSchema: {
          type: "object" as const,
          properties: {
            tableName: { type: "string", description: "逻辑表名" },
          },
          required: ["tableName"],
        },
      },
      {
        name: "get_schema",
        description: "获取表的声明式 schema（列、约束、版本）。",
        inputSchema: {
          type: "object" as const,
          properties: {
            tableName: { type: "string", description: "逻辑表名" },
          },
          required: ["tableName"],
        },
      },
      {
        name: "diff_schema",
        description:
          "对比声明 schema 与实际物理表结构。返回差异（漂移检测）。",
        inputSchema: {
          type: "object" as const,
          properties: {
            tableName: { type: "string", description: "逻辑表名" },
          },
          required: ["tableName"],
        },
      },
      {
        name: "list_schemas",
        description: "列出所有已注册的表 schema（摘要：名称、版本、列数）。",
        inputSchema: { type: "object" as const, properties: {} },
      },
      {
        name: "ensure_schema",
        description:
          "确保已注册 schema 的物理表存在。不存在则创建。用于迁移/环境初始化。",
        inputSchema: {
          type: "object" as const,
          properties: {
            tableName: { type: "string", description: "逻辑表名" },
          },
          required: ["tableName"],
        },
      },
    ];
  },

  async callTool(
    name: string,
    args: Record<string, unknown>,
    context?: ToolContext,
  ): Promise<CallToolResult> {
    const userName = context?.userName;

    switch (name) {
      case "list_tables": {
        const visible = await listVisibleTables(userName);
        if (visible.length === 0) return text("No tables in business database.");
        return json(visible);
      }

      case "describe_table": {
        const tableNames = args.tables as string[];
        if (!Array.isArray(tableNames) || tableNames.length === 0) return text("Missing tables parameter.");

        const describeOne = async (logicalName: string) => {
          const resolved = await resolveTable(userName, logicalName);
          if (!resolved) return { table: logicalName, error: "not found" };
          const colResult = await bizPool.query(
            `SELECT column_name, data_type, is_nullable
             FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = $1
             ORDER BY ordinal_position`,
            [resolved.physicalName],
          );
          if (colResult.rows.length === 0) return { table: logicalName, error: "not found" };
          return { table: logicalName, columns: colResult.rows };
        };

        if (tableNames.length === 1) {
          const result = await describeOne(tableNames[0]!);
          if ("error" in result) return text(`Table "${tableNames[0]}" not found.`);
          return json(result);
        }

        const results = await Promise.all(tableNames.map(describeOne));
        return json(results);
      }

      case "sql": {
        const sql = String(args.sql);
        const normalized = sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "").trim().toUpperCase();
        const isRead = normalized.startsWith("SELECT") || normalized.startsWith("WITH");

        if (isRead) {
          console.log("[biz_db sql/read] input:", sql);
          const check = guardQuery(sql);
          if (!check.ok) return text(check.reason);

          const map = await buildRewriteMap(userName, sql, false);
          const rewritten = applySqlRewrite(sql, map);
          console.log("[biz_db sql/read] rewritten:", rewritten);
          const result = await bizPool.query(rewritten);
          return json({ rows: result.rows, rowCount: result.rowCount });
        } else {
          console.log("[biz_db sql/write] input:", sql);
          const check = guardExecute(sql);
          if (!check.ok) return text(check.reason);

          const map = await buildRewriteMap(userName, sql, false);
          const rewritten = applySqlRewrite(sql, map);
          console.log("[biz_db sql/write] final SQL:", rewritten);
          const result = await bizPool.query(rewritten);

          // Return JSON so sandbox callToolSync can reliably parse the result.
          // If the query includes a RETURNING clause, include the returned rows.
          if (result.rows && result.rows.length > 0) {
            return json({ rows: result.rows, rowCount: result.rowCount ?? 0, command: result.command });
          }
          return json({ ok: true, rowCount: result.rowCount ?? 0, command: result.command });
        }
      }

      case "upgrade_global": {
        if (!userName) return text("Cannot upgrade: no user context.");

        const logicalName = String(args.table);
        const confirm = args.confirm === true;

        const resolved = await resolveTable(userName, logicalName);
        if (!resolved || resolved.owner !== userName) {
          return text(`User table "${logicalName}" not found.`);
        }
        if (resolved.owner === GLOBAL_USER) {
          return text(`"${logicalName}" is already a global table.`);
        }

        if (!confirm) {
          return json({
            action: "upgrade_global",
            table: logicalName,
            message: `Upgrading "${logicalName}" to global is IRREVERSIBLE. Call again with confirm=true to proceed.`,
          });
        }

        const upgraded = await upgradeToGlobal(userName, logicalName);
        if (!upgraded) {
          return text(`Failed to upgrade "${logicalName}": user table not found`);
        }

        return text(`Upgrade complete: "${logicalName}" is now a global table`);
      }

      case "list_global_tables": {
        const visible = await listVisibleTables(undefined);
        return json(visible);
      }

      /* ---------- schema management ---------- */
      case "create_table": {
        const params = schemaSvc.CreateTableParams.parse(args);
        const owner = args.global === true ? undefined : userName;
        const detail = await schemaSvc.createTable(params, owner);
        return json({ ok: true, tableName: detail.tableName, version: detail.version, columns: detail.columns, global: args.global === true });
      }

      case "alter_table": {
        const params = schemaSvc.AlterTableParams.parse(args);
        const detail = await schemaSvc.alterTable(params, userName);
        return json({ ok: true, tableName: detail.tableName, version: detail.version, columns: detail.columns });
      }

      case "drop_table": {
        const params = schemaSvc.DropTableParams.parse(args);
        await schemaSvc.dropTable(params, userName);
        return text(`Dropped table "${params.tableName}" and removed schema.`);
      }

      case "get_schema": {
        const { tableName } = schemaSvc.GetSchemaParams.parse(args);
        const detail = await schemaSvc.getSchema(tableName);
        if (!detail) return text(`No schema registered for table "${tableName}".`);
        return json(detail);
      }

      case "diff_schema": {
        const { tableName } = schemaSvc.DiffSchemaParams.parse(args);
        const diff = await schemaSvc.diffSchema(tableName, userName);
        return json(diff);
      }

      case "list_schemas": {
        const schemas = await schemaSvc.listSchemas();
        if (schemas.length === 0) return text("No schemas registered.");
        return json(schemas);
      }

      case "ensure_schema": {
        const { tableName } = schemaSvc.EnsureSchemaParams.parse(args);
        const result = await schemaSvc.ensureSchema(tableName, userName);
        return json(result);
      }

      default:
        return text(`Unknown tool: ${name}`);
    }
  },
};
