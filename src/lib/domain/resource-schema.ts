/**
 * Domain Resources — single generic resource table.
 *
 * Replaces all per-category biz-db tables (novel_characters, script_costumes,
 * script_scenes, script_shots, etc.) with one unified table.
 *
 * Categories are data, not code — LLM decides the category at creation time.
 * Code only cares about media_type (image / video / json) for rendering.
 */

import { bizPool, bizDbReady } from "@/lib/biz-db";
import {
  resolveTable,
  ensureMapping,
  GLOBAL_USER,
} from "@/lib/biz-db-namespace";

/* ------------------------------------------------------------------ */
/*  DDL                                                                */
/* ------------------------------------------------------------------ */

const LOGICAL_NAME = "domain_resources";

const DDL = `CREATE TABLE IF NOT EXISTS "$TABLE" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_type TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  category TEXT NOT NULL,
  media_type TEXT NOT NULL,
  title TEXT,
  url TEXT,
  data JSONB,
  key_resource_id TEXT,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
)`;

/** Migrate old image_gen_id column to key_resource_id. */
const MIGRATION = [
  `ALTER TABLE "$TABLE" ADD COLUMN IF NOT EXISTS key_resource_id TEXT`,
  `UPDATE "$TABLE" SET key_resource_id = image_gen_id WHERE key_resource_id IS NULL AND image_gen_id IS NOT NULL`,
];

const INDEXES = [
  `CREATE INDEX IF NOT EXISTS idx_$SHORT_scope ON "$TABLE" (scope_type, scope_id)`,
  `CREATE INDEX IF NOT EXISTS idx_$SHORT_category ON "$TABLE" (scope_id, category)`,
];

/* ------------------------------------------------------------------ */
/*  Ensure table exists                                                */
/* ------------------------------------------------------------------ */

let ensurePromise: Promise<void> | null = null;

/**
 * Ensure the domain_resources table exists in biz-db with a _global_ mapping.
 * Safe to call multiple times — concurrent callers await the same Promise.
 */
export function ensureDomainResourcesTable(): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = doEnsureDomainResourcesTable();
  }
  return ensurePromise;
}

async function doEnsureDomainResourcesTable(): Promise<void> {
  await bizDbReady;

  let physicalName: string;
  const existing = await resolveTable(GLOBAL_USER, LOGICAL_NAME);
  if (existing) {
    physicalName = existing.physicalName;
    await bizPool.query(DDL.replace("$TABLE", physicalName));
  } else {
    physicalName = await ensureMapping(GLOBAL_USER, LOGICAL_NAME);
    await bizPool.query(DDL.replace("$TABLE", physicalName));
    console.log(
      `[domain-resources] Created table "${LOGICAL_NAME}" → "${physicalName}"`,
    );
  }

  // Run migration for existing tables (adds key_resource_id if missing)
  for (const stmt of MIGRATION) {
    try {
      await bizPool.query(stmt.replaceAll("$TABLE", physicalName));
    } catch { /* column may not exist in old tables, ignore */ }
  }

  // Create indexes
  const short = physicalName.replace(/^t_/, "");
  for (const idx of INDEXES) {
    await bizPool.query(
      idx.replaceAll("$TABLE", physicalName).replaceAll("$SHORT", short),
    );
  }
}

export { LOGICAL_NAME as DOMAIN_RESOURCES_TABLE };
