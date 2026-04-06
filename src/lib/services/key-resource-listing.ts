/**
 * KeyResource listing — category-grouped resource queries.
 *
 * Single source of truth: KeyResource + KeyResourceVersion.
 * Replaces domain_resources queries for video workflow.
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
      category: { not: null },
    },
    include: {
      versions: {
        orderBy: { version: "desc" },
        take: 1,
      },
    },
    orderBy: [{ category: "asc" }, { createdAt: "asc" }],
  });

  const groups = new Map<string, ResourceItem[]>();

  for (const r of resources) {
    const currentVer = r.versions.find((v) => v.version === r.currentVersion) ?? r.versions[0];

    const item: ResourceItem = {
      id: r.id,
      key: r.key,
      category: r.category!,
      mediaType: r.mediaType,
      title: r.title ?? currentVer?.title ?? null,
      url: currentVer?.url ?? null,
      prompt: currentVer?.prompt ?? null,
      currentVersion: r.currentVersion,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };

    const list = groups.get(item.category) ?? [];
    list.push(item);
    groups.set(item.category, list);
  }

  return [...groups.entries()].map(([category, items]) => ({
    category,
    items,
  }));
}
