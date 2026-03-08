/**
 * biz-schema DDL generator — pure functions.
 *
 * Converts structured column / constraint definitions into PostgreSQL DDL.
 * No I/O; used by biz-schema-service to build SQL for execution.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Zod schemas (shared with service + MCP layer)
// ---------------------------------------------------------------------------

export const ColumnDef = z.object({
  name: z.string().min(1),
  type: z.string().min(1),            // PostgreSQL type: text, integer, serial, boolean, ...
  nullable: z.boolean().optional(),    // default: true
  default: z.string().optional(),      // raw SQL default expression
});

export type ColumnDef = z.infer<typeof ColumnDef>;

export const ConstraintDef = z.object({
  type: z.enum(["pk", "unique"]),
  columns: z.array(z.string().min(1)).min(1),
});

export type ConstraintDef = z.infer<typeof ConstraintDef>;

export const AlterAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add_column"), column: ColumnDef }),
  z.object({ action: z.literal("drop_column"), name: z.string().min(1) }),
  z.object({
    action: z.literal("alter_column"),
    name: z.string().min(1),
    type: z.string().optional(),
    nullable: z.boolean().optional(),
    default: z.string().nullable().optional(),  // null = DROP DEFAULT
  }),
  z.object({ action: z.literal("add_constraint"), constraint: ConstraintDef }),
]);

export type AlterAction = z.infer<typeof AlterAction>;

// ---------------------------------------------------------------------------
// Identifier quoting
// ---------------------------------------------------------------------------

/** Double-quote a PostgreSQL identifier to prevent injection & keyword clash. */
function qi(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

// ---------------------------------------------------------------------------
// CREATE TABLE
// ---------------------------------------------------------------------------

export function generateCreateTable(
  physicalName: string,
  columns: ColumnDef[],
  constraints?: ConstraintDef[],
): string {
  const parts: string[] = [];

  for (const col of columns) {
    let line = `  ${qi(col.name)} ${col.type.toUpperCase()}`;
    if (col.nullable === false) line += " NOT NULL";
    if (col.default !== undefined) line += ` DEFAULT ${col.default}`;
    parts.push(line);
  }

  if (constraints) {
    for (const c of constraints) {
      const cols = c.columns.map(qi).join(", ");
      if (c.type === "pk") {
        parts.push(`  PRIMARY KEY (${cols})`);
      } else {
        parts.push(`  UNIQUE (${cols})`);
      }
    }
  }

  return `CREATE TABLE IF NOT EXISTS ${qi(physicalName)} (\n${parts.join(",\n")}\n)`;
}

// ---------------------------------------------------------------------------
// ALTER TABLE
// ---------------------------------------------------------------------------

export function generateAlterTable(
  physicalName: string,
  actions: AlterAction[],
): string[] {
  const stmts: string[] = [];
  const prefix = `ALTER TABLE ${qi(physicalName)}`;

  for (const a of actions) {
    switch (a.action) {
      case "add_column": {
        let sql = `${prefix} ADD COLUMN ${qi(a.column.name)} ${a.column.type.toUpperCase()}`;
        if (a.column.nullable === false) sql += " NOT NULL";
        if (a.column.default !== undefined) sql += ` DEFAULT ${a.column.default}`;
        stmts.push(sql);
        break;
      }
      case "drop_column":
        stmts.push(`${prefix} DROP COLUMN ${qi(a.name)}`);
        break;
      case "alter_column": {
        if (a.type !== undefined) {
          stmts.push(
            `${prefix} ALTER COLUMN ${qi(a.name)} TYPE ${a.type.toUpperCase()}`,
          );
        }
        if (a.nullable === true) {
          stmts.push(`${prefix} ALTER COLUMN ${qi(a.name)} DROP NOT NULL`);
        } else if (a.nullable === false) {
          stmts.push(`${prefix} ALTER COLUMN ${qi(a.name)} SET NOT NULL`);
        }
        if (a.default === null) {
          stmts.push(`${prefix} ALTER COLUMN ${qi(a.name)} DROP DEFAULT`);
        } else if (a.default !== undefined) {
          stmts.push(
            `${prefix} ALTER COLUMN ${qi(a.name)} SET DEFAULT ${a.default}`,
          );
        }
        break;
      }
      case "add_constraint": {
        const cols = a.constraint.columns.map(qi).join(", ");
        if (a.constraint.type === "pk") {
          stmts.push(`${prefix} ADD PRIMARY KEY (${cols})`);
        } else {
          stmts.push(`${prefix} ADD UNIQUE (${cols})`);
        }
        break;
      }
    }
  }

  return stmts;
}

// ---------------------------------------------------------------------------
// DROP TABLE
// ---------------------------------------------------------------------------

export function generateDropTable(physicalName: string): string {
  return `DROP TABLE IF EXISTS ${qi(physicalName)}`;
}

// ---------------------------------------------------------------------------
// Apply alter actions to column snapshot
// ---------------------------------------------------------------------------

/**
 * Apply alter actions to a column array to produce the new snapshot.
 * Pure function; does not touch the database.
 */
export function applyActionsToColumns(
  columns: ColumnDef[],
  actions: AlterAction[],
): ColumnDef[] {
  const result = columns.map((c) => ({ ...c }));

  for (const a of actions) {
    switch (a.action) {
      case "add_column":
        result.push({ ...a.column });
        break;
      case "drop_column": {
        const idx = result.findIndex((c) => c.name === a.name);
        if (idx !== -1) result.splice(idx, 1);
        break;
      }
      case "alter_column": {
        const col = result.find((c) => c.name === a.name);
        if (col) {
          if (a.type !== undefined) col.type = a.type;
          if (a.nullable !== undefined) col.nullable = a.nullable;
          if (a.default === null) delete col.default;
          else if (a.default !== undefined) col.default = a.default;
        }
        break;
      }
      case "add_constraint":
        // Constraints are tracked separately; no column changes needed.
        break;
    }
  }

  return result;
}

/**
 * Apply add_constraint actions to existing constraints.
 */
export function applyActionsToConstraints(
  constraints: ConstraintDef[],
  actions: AlterAction[],
): ConstraintDef[] {
  const result = constraints.map((c) => ({ ...c }));
  for (const a of actions) {
    if (a.action === "add_constraint") {
      result.push({ ...a.constraint });
    }
  }
  return result;
}
