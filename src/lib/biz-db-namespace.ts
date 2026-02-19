/**
 * biz-db table namespace — mapping-table based isolation.
 *
 * Each logical table name is mapped to a UUID-based physical name via
 * the BizTableMapping table in the system database (Prisma).
 *
 * Lookup order:
 *   1. (userName, logicalName) — user's own table
 *   2. ("_global_", logicalName) — global table
 *   3. Not found → auto-create for current user (on write) or error (on read)
 *
 * LLM never sees physical names. MCP layer translates transparently.
 */

import crypto from "node:crypto";
import { prisma } from "./db";
import { bizPool } from "./biz-db";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Special userName value that marks a table as globally visible. */
export const GLOBAL_USER = "_global_";

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

export interface ResolvedTable {
  logicalName: string;
  physicalName: string;
  owner: string; // userName or GLOBAL_USER
}

/**
 * Resolve a logical table name for the given user.
 * Priority: user-owned → global → null.
 */
export async function resolveTable(
  userName: string | undefined,
  logicalName: string,
): Promise<ResolvedTable | null> {
  if (userName) {
    const own = await prisma.bizTableMapping.findUnique({
      where: { userName_logicalName: { userName, logicalName } },
    });
    if (own) {
      return { logicalName, physicalName: own.physicalName, owner: own.userName };
    }
  }

  const global = await prisma.bizTableMapping.findUnique({
    where: { userName_logicalName: { userName: GLOBAL_USER, logicalName } },
  });
  if (global) {
    return { logicalName, physicalName: global.physicalName, owner: GLOBAL_USER };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Auto-create mapping (for INSERT into new table)
// ---------------------------------------------------------------------------

function generatePhysicalName(): string {
  return `t_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

/**
 * Ensure a mapping exists for (userName, logicalName).
 * Creates one with a fresh UUID physical name if missing.
 */
export async function ensureMapping(
  userName: string,
  logicalName: string,
): Promise<string> {
  const existing = await resolveTable(userName, logicalName);
  if (existing) return existing.physicalName;

  const physicalName = generatePhysicalName();
  await prisma.bizTableMapping.create({
    data: { userName, logicalName, physicalName },
  });
  return physicalName;
}

// ---------------------------------------------------------------------------
// List tables visible to a user
// ---------------------------------------------------------------------------

export interface VisibleTable {
  table_name: string;
  scope: "user" | "global";
}

export async function listVisibleTables(
  userName: string | undefined,
): Promise<VisibleTable[]> {
  const conditions = [{ userName: GLOBAL_USER }];
  if (userName) conditions.push({ userName });

  const mappings = await prisma.bizTableMapping.findMany({
    where: { OR: conditions },
    orderBy: { logicalName: "asc" },
  });

  // Deduplicate: user-owned shadows global with same logical name
  const seen = new Map<string, VisibleTable>();
  for (const m of mappings) {
    const scope = m.userName === GLOBAL_USER ? "global" as const : "user" as const;
    const existing = seen.get(m.logicalName);
    if (!existing || scope === "user") {
      seen.set(m.logicalName, { table_name: m.logicalName, scope });
    }
  }

  return [...seen.values()].sort((a, b) => a.table_name.localeCompare(b.table_name));
}

// ---------------------------------------------------------------------------
// SQL table-name rewriting
// ---------------------------------------------------------------------------

/**
 * Regex that matches table-name positions in SQL.
 * Captures identifiers after: FROM, JOIN, INTO, UPDATE, TABLE
 * Skips subqueries (parenthesis after keyword).
 */
const TABLE_REF_RE =
  /\b(FROM|JOIN|INTO|UPDATE|TABLE)\s+(?!\s*\()("?)(\w+)\2/gi;

/** Collect all logical table names referenced in a SQL string. */
export function extractTableNames(sql: string): string[] {
  const names: string[] = [];
  let m: RegExpExecArray | null;
  TABLE_REF_RE.lastIndex = 0;
  while ((m = TABLE_REF_RE.exec(sql)) !== null) {
    names.push(m[3]!);
  }
  return names;
}

/**
 * Build a logical→physical mapping for all table names in a SQL string.
 *
 * - For existing tables: resolves via mapping table
 * - For unknown tables in write context (autoCreate): auto-creates mapping
 * - For unknown tables in read context: leaves unmapped
 */
export async function buildRewriteMap(
  userName: string | undefined,
  sql: string,
  autoCreate: boolean,
): Promise<Map<string, string>> {
  const logicalNames = [...new Set(extractTableNames(sql))];
  const map = new Map<string, string>();

  for (const name of logicalNames) {
    const resolved = await resolveTable(userName, name);
    if (resolved) {
      map.set(name, resolved.physicalName);
    } else if (autoCreate && userName) {
      const physical = await ensureMapping(userName, name);
      map.set(name, physical);
    }
  }

  return map;
}

/**
 * Rewrite all table references in a SQL string using a logical→physical map.
 */
export function applySqlRewrite(
  sql: string,
  rewriteMap: Map<string, string>,
): string {
  return sql.replace(TABLE_REF_RE, (match, keyword: string, quote: string, table: string) => {
    const physical = rewriteMap.get(table);
    if (!physical) return match;
    return `${keyword} ${quote}${physical}${quote}`;
  });
}

/**
 * Full rewrite: resolve + apply. Convenience for api-service.
 */
export async function rewriteSqlWithResolve(
  userName: string | undefined,
  sql: string,
  autoCreate: boolean = false,
): Promise<string> {
  const map = await buildRewriteMap(userName, sql, autoCreate);
  return applySqlRewrite(sql, map);
}

// ---------------------------------------------------------------------------
// Upgrade to global
// ---------------------------------------------------------------------------

/**
 * Upgrade a user table to global. Changes ownership — no data copy needed.
 * The physical table in biz-db stays the same.
 */
export async function upgradeToGlobal(
  userName: string,
  logicalName: string,
): Promise<ResolvedTable | null> {
  const mapping = await prisma.bizTableMapping.findUnique({
    where: { userName_logicalName: { userName, logicalName } },
  });
  if (!mapping) return null;

  const updated = await prisma.bizTableMapping.update({
    where: { id: mapping.id },
    data: { userName: GLOBAL_USER },
  });

  return {
    logicalName: updated.logicalName,
    physicalName: updated.physicalName,
    owner: GLOBAL_USER,
  };
}

// ---------------------------------------------------------------------------
// Find related tables (for upgrade_global confirmation)
// ---------------------------------------------------------------------------

export async function findRelatedTables(
  userName: string,
  logicalTable: string,
): Promise<string[]> {
  const apis = await prisma.api.findMany({
    include: { versions: { orderBy: { version: "desc" as const }, take: 1 } },
  });

  const related = new Set<string>();

  for (const api of apis) {
    const ver = api.versions[0];
    if (!ver) continue;
    const ops = ver.operations as unknown as { sql: string }[];

    let referencesTarget = false;
    const tablesInApi = new Set<string>();

    for (const op of ops) {
      for (const n of extractTableNames(op.sql)) {
        tablesInApi.add(n);
        if (n === logicalTable) referencesTarget = true;
      }
    }

    if (referencesTarget) {
      for (const t of tablesInApi) {
        if (t !== logicalTable) related.add(t);
      }
    }
  }

  // Only include tables owned by this user
  const result: string[] = [];
  for (const t of related) {
    const mapping = await prisma.bizTableMapping.findUnique({
      where: { userName_logicalName: { userName, logicalName: t } },
    });
    if (mapping) result.push(t);
  }

  return result.sort();
}
