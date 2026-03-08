import { z } from "zod";
import { prisma } from "@/lib/db";
import { bizPool, bizDbReady } from "@/lib/biz-db";
import { ensureMapping, resolveTable, deleteMappings } from "@/lib/biz-db-namespace";
import type { Prisma } from "@/generated/prisma";
import {
  ColumnDef,
  ConstraintDef,
  AlterAction,
  generateCreateTable,
  generateAlterTable,
  generateDropTable,
  applyActionsToColumns,
  applyActionsToConstraints,
} from "@/lib/biz-schema-ddl";

// ---------------------------------------------------------------------------
// Zod params
// ---------------------------------------------------------------------------

export const CreateTableParams = z.object({
  tableName: z.string().min(1),
  columns: z.array(ColumnDef).min(1),
  constraints: z.array(ConstraintDef).optional(),
  description: z.string().optional(),
});

export const AlterTableParams = z.object({
  tableName: z.string().min(1),
  actions: z.array(AlterAction).min(1),
  description: z.string().optional(),
});

export const DropTableParams = z.object({
  tableName: z.string().min(1),
});

export const GetSchemaParams = z.object({
  tableName: z.string().min(1),
});

export const DiffSchemaParams = z.object({
  tableName: z.string().min(1),
});

export const EnsureSchemaParams = z.object({
  tableName: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SchemaDetail {
  tableName: string;
  version: number;
  productionVersion: number;
  columns: ColumnDef[];
  constraints: ConstraintDef[];
  description: string | null;
}

export interface SchemaSummary {
  tableName: string;
  productionVersion: number;
  columnCount: number;
}

export interface SchemaDiff {
  tableName: string;
  status: "match" | "drift" | "missing_physical" | "missing_schema";
  declared: { columns: ColumnDef[] } | null;
  physical: { columns: PhysicalColumn[] } | null;
  differences: string[];
}

interface PhysicalColumn {
  column_name: string;
  data_type: string;
  is_nullable: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Query physical columns from biz-db information_schema. */
async function getPhysicalColumns(physicalName: string): Promise<PhysicalColumn[]> {
  await bizDbReady;
  const result = await bizPool.query(
    `SELECT column_name, data_type, is_nullable
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position`,
    [physicalName],
  );
  return result.rows as PhysicalColumn[];
}

// ---------------------------------------------------------------------------
// Service functions
// ---------------------------------------------------------------------------

/**
 * Create a new table: register schema v1 → generate DDL → execute → create mapping.
 */
export async function createTable(
  params: z.infer<typeof CreateTableParams>,
  userName?: string,
): Promise<SchemaDetail> {
  const { tableName, columns, constraints, description } = params;

  // Check for existing schema
  const existing = await prisma.bizSchema.findUnique({ where: { tableName } });
  if (existing) throw new Error(`Schema for table "${tableName}" already exists`);

  // Create BizSchema + v1
  const schema = await prisma.bizSchema.create({
    data: {
      tableName,
      productionVersion: 1,
      versions: {
        create: {
          version: 1,
          columns: columns as unknown as Prisma.InputJsonValue,
          constraints: (constraints ?? []) as unknown as Prisma.InputJsonValue,
          description: description ?? null,
        },
      },
    },
    include: { versions: true },
  });

  // Resolve physical name via BizTableMapping (auto-create for this user)
  const owner = userName ?? "_global_";
  const physicalName = await ensureMapping(owner, tableName);

  // Generate and execute DDL
  const ddl = generateCreateTable(physicalName, columns, constraints);
  await bizDbReady;
  await bizPool.query(ddl);
  console.log(`[biz-schema] Created table "${tableName}" → ${physicalName}`);

  return {
    tableName,
    version: 1,
    productionVersion: 1,
    columns,
    constraints: constraints ?? [],
    description: description ?? null,
  };
}

/**
 * Alter an existing table: compute new column snapshot → new version → DDL → execute.
 */
export async function alterTable(
  params: z.infer<typeof AlterTableParams>,
  userName?: string,
): Promise<SchemaDetail> {
  const { tableName, actions, description } = params;

  const schema = await prisma.bizSchema.findUnique({
    where: { tableName },
    include: { versions: { orderBy: { version: "desc" }, take: 1 } },
  });
  if (!schema) throw new Error(`Schema for table "${tableName}" not found`);

  const currentVer = schema.versions[0]!;
  const prevColumns = currentVer.columns as unknown as ColumnDef[];
  const prevConstraints = (currentVer.constraints ?? []) as unknown as ConstraintDef[];

  // Compute new snapshot
  const newColumns = applyActionsToColumns(prevColumns, actions);
  const newConstraints = applyActionsToConstraints(prevConstraints, actions);
  const nextVersion = currentVer.version + 1;

  // Persist new version
  await prisma.bizSchemaVersion.create({
    data: {
      bizSchemaId: schema.id,
      version: nextVersion,
      columns: newColumns as unknown as Prisma.InputJsonValue,
      constraints: newConstraints as unknown as Prisma.InputJsonValue,
      description: description ?? null,
    },
  });
  await prisma.bizSchema.update({
    where: { id: schema.id },
    data: { productionVersion: nextVersion },
  });

  // Resolve physical name & execute DDL
  const resolved = await resolveTable(userName, tableName);
  if (!resolved) throw new Error(`No physical mapping for table "${tableName}"`);

  const stmts = generateAlterTable(resolved.physicalName, actions);
  await bizDbReady;
  for (const stmt of stmts) {
    await bizPool.query(stmt);
  }
  console.log(`[biz-schema] Altered table "${tableName}" → v${nextVersion} (${stmts.length} DDL stmts)`);

  return {
    tableName,
    version: nextVersion,
    productionVersion: nextVersion,
    columns: newColumns,
    constraints: newConstraints,
    description: description ?? null,
  };
}

/**
 * Drop a table: execute DDL → remove schema + mapping.
 */
export async function dropTable(
  params: z.infer<typeof DropTableParams>,
  userName?: string,
): Promise<void> {
  const { tableName } = params;

  const resolved = await resolveTable(userName, tableName);
  if (resolved) {
    const ddl = generateDropTable(resolved.physicalName);
    await bizDbReady;
    await bizPool.query(ddl);
    await deleteMappings(userName, [tableName]);
  }

  // Remove schema registry entry (even if physical table was already gone)
  await prisma.bizSchema.deleteMany({ where: { tableName } });
  console.log(`[biz-schema] Dropped table "${tableName}"`);
}

/**
 * Get schema detail for a table (production version).
 */
export async function getSchema(tableName: string): Promise<SchemaDetail | null> {
  const schema = await prisma.bizSchema.findUnique({ where: { tableName } });
  if (!schema) return null;

  const ver = await prisma.bizSchemaVersion.findUnique({
    where: { bizSchemaId_version: { bizSchemaId: schema.id, version: schema.productionVersion } },
  });
  if (!ver) return null;

  return {
    tableName,
    version: ver.version,
    productionVersion: schema.productionVersion,
    columns: ver.columns as unknown as ColumnDef[],
    constraints: (ver.constraints ?? []) as unknown as ConstraintDef[],
    description: ver.description,
  };
}

/**
 * List all registered schemas (summary).
 */
export async function listSchemas(): Promise<SchemaSummary[]> {
  const schemas = await prisma.bizSchema.findMany({
    include: { versions: { orderBy: { version: "desc" }, take: 1 } },
    orderBy: { tableName: "asc" },
  });

  return schemas
    .filter((s) => s.versions.length > 0)
    .map((s) => {
      const cols = s.versions[0]!.columns as unknown as ColumnDef[];
      return {
        tableName: s.tableName,
        productionVersion: s.productionVersion,
        columnCount: cols.length,
      };
    });
}

/**
 * Compare declared schema vs physical table structure.
 */
export async function diffSchema(
  tableName: string,
  userName?: string,
): Promise<SchemaDiff> {
  const schema = await getSchema(tableName);
  const resolved = await resolveTable(userName, tableName);

  if (!schema && !resolved) {
    return { tableName, status: "missing_schema", declared: null, physical: null, differences: ["Table not found in schema registry or physical database"] };
  }

  if (!schema) {
    const physCols = resolved ? await getPhysicalColumns(resolved.physicalName) : [];
    return { tableName, status: "missing_schema", declared: null, physical: { columns: physCols }, differences: ["Physical table exists but no schema registered"] };
  }

  if (!resolved) {
    return { tableName, status: "missing_physical", declared: { columns: schema.columns }, physical: null, differences: ["Schema registered but no physical table found"] };
  }

  const physCols = await getPhysicalColumns(resolved.physicalName);
  if (physCols.length === 0) {
    return { tableName, status: "missing_physical", declared: { columns: schema.columns }, physical: null, differences: ["Schema registered but physical table has no columns (or doesn't exist)"] };
  }

  // Compare
  const differences: string[] = [];
  const declaredNames = new Set(schema.columns.map((c) => c.name));
  const physicalNames = new Set(physCols.map((c) => c.column_name));

  for (const name of declaredNames) {
    if (!physicalNames.has(name)) {
      differences.push(`Column "${name}" declared but missing in physical table`);
    }
  }
  for (const name of physicalNames) {
    if (!declaredNames.has(name)) {
      differences.push(`Column "${name}" exists in physical table but not declared in schema`);
    }
  }

  return {
    tableName,
    status: differences.length === 0 ? "match" : "drift",
    declared: { columns: schema.columns },
    physical: { columns: physCols },
    differences,
  };
}

/**
 * Ensure a registered schema's physical table exists and matches.
 * Used for migration / environment setup.
 */
export async function ensureSchema(
  tableName: string,
  userName?: string,
): Promise<{ action: "created" | "exists" | "no_schema" }> {
  const schema = await getSchema(tableName);
  if (!schema) return { action: "no_schema" };

  const owner = userName ?? "_global_";
  const physicalName = await ensureMapping(owner, tableName);

  // Check if table already exists
  const physCols = await getPhysicalColumns(physicalName);
  if (physCols.length > 0) return { action: "exists" };

  // Create from schema
  const ddl = generateCreateTable(physicalName, schema.columns, schema.constraints);
  await bizDbReady;
  await bizPool.query(ddl);
  console.log(`[biz-schema] ensureSchema: created "${tableName}" → ${physicalName}`);

  return { action: "created" };
}
