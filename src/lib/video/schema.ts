/**
 * Video workflow — fixed table schema.
 *
 * Declares DDL for the 5 domain tables and ensures they exist in biz-db
 * with _global_ BizTableMapping entries on startup.
 *
 * This is the single source of truth for the video workflow schema.
 * LLM skills reference these tables by logical name; the mapping layer
 * transparently resolves to physical UUID-based names.
 */

import { bizPool, bizDbReady } from "@/lib/biz-db";
import {
  resolveTable,
  ensureMapping,
  GLOBAL_USER,
} from "@/lib/biz-db-namespace";

/* ------------------------------------------------------------------ */
/*  DDL definitions                                                    */
/* ------------------------------------------------------------------ */

interface TableDef {
  logicalName: string;
  ddl: string; // CREATE TABLE IF NOT EXISTS using $TABLE placeholder
}

/**
 * $TABLE is replaced with the physical name at creation time.
 * All tables use UUID primary keys with gen_random_uuid().
 */
const TABLES: readonly TableDef[] = [
  {
    logicalName: "novel_characters",
    ddl: `CREATE TABLE IF NOT EXISTS "$TABLE" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  novel_id TEXT NOT NULL,
  character_id TEXT NOT NULL,
  character_name TEXT NOT NULL,
  physical_traits TEXT,
  portrait_url TEXT,
  portrait_prompt TEXT,
  card_raw TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
)`,
  },
  {
    logicalName: "novel_scripts",
    ddl: `CREATE TABLE IF NOT EXISTS "$TABLE" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  novel_id TEXT NOT NULL,
  script_key TEXT NOT NULL,
  script_name TEXT,
  script_content TEXT,
  storyboard_raw TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
)`,
  },
  {
    logicalName: "script_scenes",
    ddl: `CREATE TABLE IF NOT EXISTS "$TABLE" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  script_id UUID NOT NULL,
  scene_index INTEGER NOT NULL,
  scene_title TEXT,
  scene_desc TEXT,
  scene_image_url TEXT
)`,
  },
  {
    logicalName: "script_shots",
    ddl: `CREATE TABLE IF NOT EXISTS "$TABLE" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  script_id UUID NOT NULL,
  scene_index INTEGER NOT NULL,
  shot_index TEXT,
  shot_type TEXT,
  definition TEXT,
  image_prompt TEXT,
  video_prompt TEXT,
  image_url TEXT,
  video_url TEXT
)`,
  },
  {
    logicalName: "script_costumes",
    ddl: `CREATE TABLE IF NOT EXISTS "$TABLE" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  script_id UUID NOT NULL,
  character_name TEXT NOT NULL,
  costume_image_url TEXT
)`,
  },
];

/* ------------------------------------------------------------------ */
/*  Ensure schema exists                                               */
/* ------------------------------------------------------------------ */

let ensured = false;

/**
 * Ensure all video workflow tables exist in biz-db with _global_ mappings.
 * Safe to call multiple times — only runs once.
 *
 * For each table:
 * 1. Check if a _global_ mapping already exists → skip if so
 * 2. Create a new mapping via ensureMapping(_global_, logicalName)
 * 3. Execute CREATE TABLE IF NOT EXISTS with the physical name
 */
export async function ensureVideoSchema(): Promise<void> {
  if (ensured) return;
  ensured = true;

  await bizDbReady;

  for (const table of TABLES) {
    const existing = await resolveTable(GLOBAL_USER, table.logicalName);
    if (existing) {
      // Mapping exists — ensure the physical table also exists (idempotent)
      const ddl = table.ddl.replace("$TABLE", existing.physicalName);
      await bizPool.query(ddl);
      continue;
    }

    // Create mapping + physical table
    const physicalName = await ensureMapping(GLOBAL_USER, table.logicalName);
    const ddl = table.ddl.replace("$TABLE", physicalName);
    await bizPool.query(ddl);
    console.log(`[video-schema] Created table "${table.logicalName}" → "${physicalName}"`);
  }
}

/** The logical names of all video workflow tables. */
export const VIDEO_TABLE_NAMES = TABLES.map((t) => t.logicalName);
