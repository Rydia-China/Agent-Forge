/**
 * SQL security guard for biz-db tools.
 *
 * Centralised validation applied to every raw SQL that enters XTDB through the
 * `query` and `execute` MCP tools.
 */

import { codeOnly } from "./sql-segments";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SqlCheckResult = { ok: true } | { ok: false; reason: string };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Keywords that must never appear anywhere in user SQL. */
const FORBIDDEN_KEYWORDS = ["ERASE"];

/**
 * System tables / schemas that raw queries must not reference.
 * Matched as word-boundary patterns against the normalised SQL.
 */
const BLOCKED_IDENTIFIERS = [
  "PG_CATALOG",
  "PG_USER",
  "PG_SHADOW",
  "PG_AUTHID",
  "PG_ROLES",
  "INFORMATION_SCHEMA",
];

/** Allowed first keyword for `query` (read-only) tool. */
const QUERY_PREFIXES = ["SELECT", "WITH"];

/** Allowed first keyword for `execute` (write) tool. */
const EXECUTE_PREFIXES = ["INSERT", "UPDATE", "DELETE"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Strip SQL comments (line `--` and block `/* ... * /`) and collapse whitespace.
 * Returns UPPER-CASED result so callers can do case-insensitive matching once.
 */
function normalizeSql(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, "") // line comments
    .replace(/\/\*[\s\S]*?\*\//g, "") // block comments
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function containsForbiddenKeyword(normalized: string): string | null {
  for (const kw of FORBIDDEN_KEYWORDS) {
    if (new RegExp(`\\b${kw}\\b`).test(normalized)) return kw;
  }
  return null;
}

function referencesBlockedIdentifier(normalized: string): string | null {
  for (const id of BLOCKED_IDENTIFIERS) {
    if (new RegExp(`\\b${id}\\b`).test(normalized)) return id.toLowerCase();
  }
  // XTDB internal schema: xt.txs, xt.anything — match XT. followed by word char
  if (/\bXT\.\w/.test(normalized)) return "xt.*";
  return null;
}

/**
 * Detect multi-statement injection.
 * Uses string-literal-aware segmenter to strip all '...' content, then checks
 * whether more than one non-empty statement remains after splitting on `;`.
 */
function containsMultipleStatements(normalized: string): boolean {
  const withoutStrings = codeOnly(normalized);
  const parts = withoutStrings.split(";").filter((p) => p.trim().length > 0);
  return parts.length > 1;
}

// ---------------------------------------------------------------------------
// Public guards
// ---------------------------------------------------------------------------

/** Validate SQL for the read-only `query` tool. */
export function guardQuery(sql: string): SqlCheckResult {
  const n = normalizeSql(sql);

  const forbidden = containsForbiddenKeyword(n);
  if (forbidden)
    return {
      ok: false,
      reason: `BLOCKED: ${forbidden} is forbidden — it permanently destroys all history.`,
    };

  const blocked = referencesBlockedIdentifier(n);
  if (blocked)
    return {
      ok: false,
      reason: `BLOCKED: Access to "${blocked}" is not allowed. Use list_tables / describe_table instead.`,
    };

  if (containsMultipleStatements(n))
    return { ok: false, reason: "BLOCKED: Multiple SQL statements are not allowed." };

  if (!QUERY_PREFIXES.some((p) => n.startsWith(p)))
    return {
      ok: false,
      reason: "BLOCKED: Only SELECT queries are allowed. Use the execute tool for DML.",
    };

  return { ok: true };
}

/** Validate SQL for the write `execute` tool. */
export function guardExecute(sql: string): SqlCheckResult {
  const n = normalizeSql(sql);

  const forbidden = containsForbiddenKeyword(n);
  if (forbidden)
    return {
      ok: false,
      reason:
        `BLOCKED: ${forbidden} is forbidden — it permanently destroys all history. ` +
        "Use DELETE instead; the data can always be recovered via time-travel.",
    };

  const blocked = referencesBlockedIdentifier(n);
  if (blocked)
    return {
      ok: false,
      reason: `BLOCKED: Access to "${blocked}" is not allowed.`,
    };

  if (containsMultipleStatements(n))
    return { ok: false, reason: "BLOCKED: Multiple SQL statements are not allowed." };

  if (!EXECUTE_PREFIXES.some((p) => n.startsWith(p)))
    return {
      ok: false,
      reason: "BLOCKED: Only INSERT, UPDATE, DELETE statements are allowed.",
    };

  return { ok: true };
}
