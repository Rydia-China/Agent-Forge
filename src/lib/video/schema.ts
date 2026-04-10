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
/*  novels DDL                                                         */
/* ------------------------------------------------------------------ */

const NOVELS_LOGICAL = "novels";

const NOVELS_DDL = `CREATE TABLE IF NOT EXISTS "$TABLE" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  episode_count INT DEFAULT 0,
  synopsis JSONB,
  character_arcs JSONB,
  location_bible JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
)`;

/** Columns that may be missing on older novels tables — idempotent migration. */
const NOVELS_MIGRATIONS = [
  `ALTER TABLE "$TABLE" ADD COLUMN IF NOT EXISTS synopsis JSONB`,
  `ALTER TABLE "$TABLE" ADD COLUMN IF NOT EXISTS character_arcs JSONB`,
  `ALTER TABLE "$TABLE" ADD COLUMN IF NOT EXISTS location_bible JSONB`,
];

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

let ensurePromise: Promise<void> | null = null;

/**
 * Ensure video workflow tables exist in biz-db.
 * Safe to call multiple times — concurrent callers await the same Promise.
 */
export function ensureVideoSchema(): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = doEnsureVideoSchema();
  }
  return ensurePromise;
}

async function doEnsureVideoSchema(): Promise<void> {
  await bizDbReady;

  // 1. domain_resources (generic)
  await ensureDomainResourcesTable();

  // 2. novels (local novel registry)
  let novelsPn: string;
  const existingNovels = await resolveTable(GLOBAL_USER, NOVELS_LOGICAL);
  if (existingNovels) {
    novelsPn = existingNovels.physicalName;
    await bizPool.query(NOVELS_DDL.replace("$TABLE", novelsPn));
  } else {
    novelsPn = await ensureMapping(GLOBAL_USER, NOVELS_LOGICAL);
    await bizPool.query(NOVELS_DDL.replace("$TABLE", novelsPn));
    console.log(`[video-schema] Created table "${NOVELS_LOGICAL}" → "${novelsPn}"`);
  }
  for (const stmt of NOVELS_MIGRATIONS) {
    await bizPool.query(stmt.replaceAll("$TABLE", novelsPn));
  }

  // 3. novel_scripts (episode container — system-managed, all columns)
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
export const VIDEO_TABLE_NAMES = ["domain_resources", "novels", "novel_scripts"];
