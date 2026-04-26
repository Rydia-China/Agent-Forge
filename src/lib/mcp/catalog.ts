import type { McpProvider } from "./types";
import { registry } from "./registry";
import { bizDbMcp } from "./static/biz-db";
import { videoMgrMcp } from "./static/video-mgr";
import { langfuseMcp } from "./static/langfuse";
import { langfuseAdminMcp } from "./static/langfuse-admin";
import { subagentMcp } from "./static/subagent";
import { ossMcp } from "./static/oss";

/* ------------------------------------------------------------------ */
/*  Catalog entry                                                      */
/* ------------------------------------------------------------------ */

export interface McpCatalogEntry {
  readonly name: string;
  readonly provider: McpProvider;
}

/* ------------------------------------------------------------------ */
/*  Static catalog — all non-core providers                            */
/* ------------------------------------------------------------------ */

const CATALOG: readonly McpCatalogEntry[] = [
  { name: "biz_db", provider: bizDbMcp },
  { name: "video_mgr", provider: videoMgrMcp },
  { name: "langfuse", provider: langfuseMcp },
  { name: "langfuse_admin", provider: langfuseAdminMcp },
  { name: "subagent", provider: subagentMcp },
  { name: "oss", provider: ossMcp },
];

const byName = new Map<string, McpCatalogEntry>(
  CATALOG.map((e) => [e.name, e]),
);

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/** All catalog entries (regardless of env availability). */
export function getCatalogEntries(): readonly McpCatalogEntry[] {
  return CATALOG;
}

/** Is the name a known catalog entry? */
export function isCatalogEntry(name: string): boolean {
  return byName.has(name);
}
