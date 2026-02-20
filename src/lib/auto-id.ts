/**
 * Auto-fill _id for INSERT statements targeting XTDB.
 *
 * XTDB requires every row to have an `_id` field. When the agent omits it
 * from an INSERT, this module injects auto-generated UUIDs transparently.
 */

import crypto from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AutoFillResult {
  /** The (possibly modified) SQL string. */
  sql: string;
  /** UUIDs injected, in row order. Empty if no injection was performed. */
  generatedIds: string[];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Match INSERT with explicit column list:
 *   INSERT INTO <table> (<columns>) VALUES ...
 */
const INSERT_RE =
  /^(\s*INSERT\s+INTO\s+(?:"[^"]+"|[\w]+)\s*)\(([^)]+)\)\s*(VALUES\s+)([\s\S]*)$/i;

/**
 * If `_id` is absent from the column list, prepend it and inject a UUID
 * into every VALUES group. Otherwise return the SQL unchanged.
 */
export function autoFillId(sql: string): AutoFillResult {
  const pass: AutoFillResult = { sql, generatedIds: [] };

  const m = INSERT_RE.exec(sql);
  if (!m) return pass;

  const prefix = m[1]!;
  const colsPart = m[2]!;
  const valuesKw = m[3]!;
  const valuesRest = m[4]!;

  // Already has _id → nothing to do
  const cols = colsPart
    .split(",")
    .map((c) => c.trim().replace(/"/g, "").toLowerCase());
  if (cols.includes("_id")) return pass;

  // Locate each top-level (...) group in the VALUES clause
  const groups = locateValueGroups(valuesRest);
  if (groups.length === 0) return pass;

  const generatedIds: string[] = [];
  let patched = valuesRest;

  // Process in reverse so earlier offsets stay valid
  for (let i = groups.length - 1; i >= 0; i--) {
    const { start, end } = groups[i]!;
    const inner = patched.slice(start + 1, end); // strip outer ( )
    const id = crypto.randomUUID();
    generatedIds.unshift(id);
    patched =
      patched.slice(0, start) + `('${id}', ${inner})` + patched.slice(end + 1);
  }

  return {
    sql: `${prefix}(_id, ${colsPart}) ${valuesKw}${patched}`,
    generatedIds,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface Span {
  start: number;
  end: number;
}

/**
 * Find top-level parenthesised groups, correctly skipping SQL string
 * literals ('...') and nested expressions.
 */
function locateValueGroups(s: string): Span[] {
  const groups: Span[] = [];
  let depth = 0;
  let start = -1;
  let inStr = false;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;

    if (inStr) {
      // SQL escapes single quotes by doubling: ''
      if (ch === "'" && s[i + 1] === "'") {
        i++;
        continue;
      }
      if (ch === "'") inStr = false;
      continue;
    }

    if (ch === "'") {
      inStr = true;
      continue;
    }
    if (ch === "(") {
      if (depth === 0) start = i;
      depth++;
      continue;
    }
    if (ch === ")") {
      depth--;
      if (depth === 0 && start >= 0) {
        groups.push({ start, end: i });
        start = -1;
      }
    }
  }

  return groups;
}
