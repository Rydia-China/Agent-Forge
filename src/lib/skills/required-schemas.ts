import type { ColumnDef, ConstraintDef } from "@/lib/biz-schema-ddl";
import { getSchema } from "@/lib/services/biz-schema-service";

// ---------------------------------------------------------------------------
// requiredSchemas — shared helpers for skills__get and system-prompt preload
// ---------------------------------------------------------------------------

export interface RequiredSchema {
  tableName: string;
  columns: ColumnDef[];
  constraints?: ConstraintDef[];
}

/**
 * Extract `requiredSchemas` from skill metadata (if present).
 */
export function extractRequiredSchemas(
  metadata: unknown,
): RequiredSchema[] | null {
  if (
    metadata &&
    typeof metadata === "object" &&
    "requiredSchemas" in metadata &&
    Array.isArray((metadata as Record<string, unknown>).requiredSchemas)
  ) {
    return (metadata as Record<string, unknown>).requiredSchemas as RequiredSchema[];
  }
  return null;
}

/**
 * Check which required schemas are missing from the BizSchema registry.
 * Returns only the schemas that need to be created.
 */
export async function findMissingSchemas(
  schemas: RequiredSchema[],
): Promise<RequiredSchema[]> {
  const missing: RequiredSchema[] = [];
  for (const s of schemas) {
    const existing = await getSchema(s.tableName);
    if (!existing) missing.push(s);
  }
  return missing;
}

/**
 * Build a directive block instructing the LLM to create missing tables.
 */
export function buildSchemaDirective(missing: RequiredSchema[]): string {
  const header =
    `\n\n---\n⚠️ MISSING TABLES (${missing.length}): ${missing.map((s) => s.tableName).join(", ")}\n` +
    "Call `biz_db__create_table` for each using the exact definitions below.\n" +
    "These are shared infrastructure tables — always pass `global: true`.\n";

  const blocks = missing.map((s) => {
    const def = {
      tableName: s.tableName,
      columns: s.columns,
      ...(s.constraints?.length ? { constraints: s.constraints } : {}),
      global: true,
    };
    return "\n" + s.tableName + ":\n```json\n" + JSON.stringify(def, null, 2) + "\n```";
  });

  return header + blocks.join("") + "\n---";
}

/**
 * Append schema directive to skill content if any required tables are missing.
 * Returns the (possibly augmented) content string.
 */
export async function appendSchemaDirectiveIfNeeded(
  content: string,
  metadata: unknown,
): Promise<string> {
  const schemas = extractRequiredSchemas(metadata);
  if (!schemas) return content;
  const missing = await findMissingSchemas(schemas);
  if (missing.length === 0) return content;
  return content + buildSchemaDirective(missing);
}
