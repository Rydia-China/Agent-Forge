/**
 * KeyResource listing — category-grouped resource queries.
 *
 * Single source of truth: KeyResource + KeyResourceVersion.
 * Used by the video workflow to render resource panels from versioned resources.
 */

import { prisma } from "@/lib/db";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface ResourceItem {
  id: string;
  key: string;
  category: string;
  mediaType: string;
  title: string | null;
  url: string | null;
  data: unknown;
  prompt: string | null;
  currentVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ResourceCategoryGroup {
  category: string;
  items: ResourceItem[];
}

/* ------------------------------------------------------------------ */
/*  Query: list by scope, grouped by category                          */
/* ------------------------------------------------------------------ */

/**
 * List all KeyResources for a given scope, grouped by category.
 * Returns only resources that have a category set.
 *
 * Keep category filtering and sorting in application code instead of Prisma
 * query args. Dev servers may keep an older generated Prisma Client loaded
 * across schema updates; querying by newly added fields would then fail before
 * the caller can recover.
 * URL is resolved from the current version.
 */
export async function listResourcesByScope(
  scopeType: string,
  scopeId: string,
): Promise<ResourceCategoryGroup[]> {
  const resources = await prisma.keyResource.findMany({
    where: {
      scopeType,
      scopeId,
    },
    include: {
      versions: {
        orderBy: { version: "asc" },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const groups = new Map<string, ResourceItem[]>();

  for (const resource of resources) {
    if (!resource.category) continue;

    const currentVersion =
      resource.versions.find((version) => version.version === resource.currentVersion) ??
      resource.versions[0];

    const item: ResourceItem = {
      id: resource.id,
      key: resource.key,
      category: resource.category,
      mediaType: resource.mediaType,
      title: resource.title ?? currentVersion?.title ?? null,
      url: currentVersion?.url ?? null,
      data: resource.mediaType === "json" ? currentVersion?.data ?? null : null,
      prompt: currentVersion?.prompt ?? null,
      currentVersion: resource.currentVersion,
      createdAt: resource.createdAt,
      updatedAt: resource.updatedAt,
    };

    const list = groups.get(item.category) ?? [];
    list.push(item);
    groups.set(item.category, list);
  }

  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([category, items]) => ({
      category,
      items,
    }));
}
