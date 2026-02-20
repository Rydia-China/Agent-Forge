/**
 * String-literal-aware SQL utilities.
 *
 * SQL parsed via regex alone can't distinguish code from string literals,
 * leading to false matches inside VALUES / SET clauses.  This module provides
 * a lightweight character-level segmenter that splits SQL into alternating
 * "code" and "string" segments, so regex operations can be safely confined
 * to code-only portions.
 *
 * SQL string literal rules:
 *   - delimited by single quotes: 'hello'
 *   - single quotes escaped by doubling: 'it''s ok'
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SqlSegment {
  type: "code" | "string";
  text: string;
}

// ---------------------------------------------------------------------------
// Segmenter
// ---------------------------------------------------------------------------

/**
 * Split a SQL string into alternating code / string-literal segments.
 *
 * ```
 * splitSegments("SELECT * FROM t WHERE name = 'hello'")
 * // → [
 * //   { type: "code",   text: "SELECT * FROM t WHERE name = " },
 * //   { type: "string", text: "'hello'" },
 * // ]
 * ```
 */
export function splitSegments(sql: string): SqlSegment[] {
  const segments: SqlSegment[] = [];
  let i = 0;
  let start = 0;

  while (i < sql.length) {
    if (sql[i] === "'") {
      // Flush preceding code segment
      if (i > start) {
        segments.push({ type: "code", text: sql.slice(start, i) });
      }

      // Scan to end of string literal (handle '' escaping)
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") {
          j += 2; // skip escaped quote
          continue;
        }
        if (sql[j] === "'") {
          j++; // include closing quote
          break;
        }
        j++;
      }

      segments.push({ type: "string", text: sql.slice(i, j) });
      start = j;
      i = j;
    } else {
      i++;
    }
  }

  // Trailing code
  if (start < sql.length) {
    segments.push({ type: "code", text: sql.slice(start) });
  }

  return segments;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Apply a regex replacement only to code segments (skipping string literals).
 *
 * The `regex` must have the `g` flag so that `.replace()` processes all
 * occurrences within each code segment.
 */
export function replaceInCode(
  sql: string,
  regex: RegExp,
  replacer: (...args: string[]) => string,
): string {
  const segments = splitSegments(sql);
  return segments
    .map((seg) => (seg.type === "string" ? seg.text : seg.text.replace(regex, replacer)))
    .join("");
}

/**
 * Return only the code portions of a SQL string (string literals stripped).
 * Useful for safe keyword / identifier scanning.
 */
export function codeOnly(sql: string): string {
  return splitSegments(sql)
    .filter((s) => s.type === "code")
    .map((s) => s.text)
    .join(" ");
}
