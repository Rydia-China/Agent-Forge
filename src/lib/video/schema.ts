/**
 * Video workflow — schema bootstrap.
 *
 * Ensures the domain_resources table and novel_scripts table exist in biz-db.
 * domain_resources is the single generic resource table (categories are data).
 * novel_scripts is the episode container (independent, fully preserved).
 */

import { bizPool, bizDbReady } from "@/lib/biz-db";
import {
  resolveTable,
  ensureMapping,
  GLOBAL_USER,
} from "@/lib/biz-db-namespace";
import { ensureDomainResourcesTable } from "@/lib/domain/resource-schema";

/* ------------------------------------------------------------------ */
/*  novel_scripts DDL                                                  */
/* ------------------------------------------------------------------ */

const NOVEL_SCRIPTS_LOGICAL = "novel_scripts";

const NOVEL_SCRIPTS_DDL = `CREATE TABLE IF NOT EXISTS "$TABLE" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  novel_id TEXT NOT NULL,
  script_key TEXT NOT NULL,
  script_name TEXT,
  script_content TEXT,
  init_result JSONB,
  characters JSONB,
  costumes JSONB,
  storyboard_raw TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
)`;

/** Columns that may be missing on older tables — idempotent migration. */
const NOVEL_SCRIPTS_MIGRATIONS = [
  `ALTER TABLE "$TABLE" ADD COLUMN IF NOT EXISTS init_result JSONB`,
  `ALTER TABLE "$TABLE" ADD COLUMN IF NOT EXISTS characters JSONB`,
  `ALTER TABLE "$TABLE" ADD COLUMN IF NOT EXISTS costumes JSONB`,
  `ALTER TABLE "$TABLE" ADD COLUMN IF NOT EXISTS storyboard_raw TEXT`,
  `ALTER TABLE "$TABLE" ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`,
];

/* ------------------------------------------------------------------ */
/*  Ensure schema exists                                               */
/* ------------------------------------------------------------------ */

let ensured = false;

/**
 * Ensure video workflow tables exist in biz-db.
 * Safe to call multiple times — only runs once.
 */
export async function ensureVideoSchema(): Promise<void> {
  if (ensured) return;
  ensured = true;

  await bizDbReady;

  // 1. domain_resources (generic)
  await ensureDomainResourcesTable();

  // 2. novel_scripts (episode container — system-managed, all columns)
  const existing = await resolveTable(GLOBAL_USER, NOVEL_SCRIPTS_LOGICAL);
  let physicalName: string;
  if (existing) {
    physicalName = existing.physicalName;
    await bizPool.query(NOVEL_SCRIPTS_DDL.replace("$TABLE", physicalName));
  } else {
    physicalName = await ensureMapping(GLOBAL_USER, NOVEL_SCRIPTS_LOGICAL);
    await bizPool.query(NOVEL_SCRIPTS_DDL.replace("$TABLE", physicalName));
    console.log(`[video-schema] Created table "${NOVEL_SCRIPTS_LOGICAL}" → "${physicalName}"`);
  }

  // 3. Idempotent migrations — add columns that may be missing on older tables
  for (const stmt of NOVEL_SCRIPTS_MIGRATIONS) {
    await bizPool.query(stmt.replaceAll("$TABLE", physicalName));
  }
}

/** The logical names of all video workflow tables. */
export const VIDEO_TABLE_NAMES = ["domain_resources", "novel_scripts"];
