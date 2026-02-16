import type { McpProvider } from "./types";
import { registry } from "./registry";
import { bizDbMcp } from "./static/biz-db";
import { apisMcp } from "./static/apis";
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
  /** Whether the env prerequisites for this provider are met. */
  readonly available: boolean;
  /** The provider instance (always present, but only usable when available). */
  readonly provider: McpProvider;
}

/* ------------------------------------------------------------------ */
/*  Static catalog — all non-core providers                            */
/* ------------------------------------------------------------------ */

const CATALOG: readonly McpCatalogEntry[] = [
  { name: "biz_db", provider: bizDbMcp, available: true },
  { name: "apis", provider: apisMcp, available: true },
  {
    name: "video_mgr",
    provider: videoMgrMcp,
    available: !!(process.env.FC_GENERATE_IMAGE_URL || process.env.FC_GENERATE_VIDEO_URL),
  },
  {
    name: "langfuse",
    provider: langfuseMcp,
    available: !!(
      process.env.LANGFUSE_BASE_URL &&
      process.env.LANGFUSE_PUBLIC_KEY &&
      process.env.LANGFUSE_SECRET_KEY
    ),
  },
  {
    name: "langfuse_admin",
    provider: langfuseAdminMcp,
    available: !!(
      process.env.LANGFUSE_BASE_URL &&
      process.env.LANGFUSE_PUBLIC_KEY &&
      process.env.LANGFUSE_SECRET_KEY
    ),
  },
  {
    name: "subagent",
    provider: subagentMcp,
    available: !!process.env.LLM_API_KEY,
  },
  {
    name: "oss",
    provider: ossMcp,
    available: !!(
      process.env.OSS_REGION &&
      process.env.OSS_BUCKET &&
      process.env.OSS_ACCESS_KEY_ID &&
      process.env.OSS_ACCESS_KEY_SECRET
    ),
  },
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

/**
 * List catalog entries that are available (env ok) but NOT currently
 * registered in the registry.
 */
export function listAvailableCatalog(): McpCatalogEntry[] {
  return CATALOG.filter(
    (e) => e.available && !registry.getProvider(e.name),
  );
}

/**
 * Load a catalog provider into the registry.
 * Returns the provider name, or throws if not found / not available.
 */
export function loadFromCatalog(name: string): string {
  const entry = byName.get(name);
  if (!entry) throw new Error(`"${name}" is not a catalog MCP`);
  if (!entry.available) {
    throw new Error(`MCP "${name}" is not available (missing env configuration)`);
  }
  if (registry.getProvider(name)) return name; // already loaded
  registry.register(entry.provider);
  return name;
}
