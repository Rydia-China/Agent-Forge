/**
 * Resource CRUD Service - Resource query and mutation operations
 * 
 * This service handles:
 * - Resource queries (getResources, getResourcesByScope)
 * - Resource mutations (updateResourceData, deleteResource)
 * - KeyResource version resolution
 */

import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma";
import type {
  DomainResource,
  CategoryGroup,
  DomainResources,
} from "@/lib/video/resource-types";

/* ------------------------------------------------------------------ */
/*  Public API: Resource queries                                       */
/* ------------------------------------------------------------------ */

/**
 * Get all resources for a given scope, grouped by category.
 * When a resource is linked to a KeyResource (keyResourceId), resolve
 * the URL from the KeyResource's current version so the panel always
 * reflects the active version (after rollback / regenerate).
 */
async function getResourcesByScope(
  scopeType: string,
  scopeId: string,
): Promise<CategoryGroup[]> {
  const resources = await prisma.domainResource.findMany({
    where: { scopeType, scopeId },
    orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
  });

  const domainResources: DomainResource[] = resources.map((r): DomainResource => ({
    id: r.id,
    category: r.category,
    mediaType: r.mediaType,
    title: r.title,
    url: r.url,
    data: r.data,
    keyResourceId: r.keyResourceId,
    sortOrder: r.sortOrder,
  }));

  // Collect linked KeyResource IDs to resolve current-version URLs in a single query
  const linkedIds = domainResources
    .map((r) => r.keyResourceId)
    .filter((id): id is string => id != null);

  if (linkedIds.length > 0) {
    const keyResources = await prisma.keyResource.findMany({
      where: { id: { in: linkedIds } },
      include: { versions: { orderBy: { version: "asc" } } },
    });

    const urlMap = new Map<string, string | null>();
    for (const kr of keyResources) {
      const curVer = kr.versions.find((v: { version: number; url: string | null }) => v.version === kr.currentVersion);
      urlMap.set(kr.id, curVer?.url ?? null);
    }

    // Override static url with the current-version url from KeyResource
    for (const r of domainResources) {
      if (r.keyResourceId && urlMap.has(r.keyResourceId)) {
        r.url = urlMap.get(r.keyResourceId) ?? r.url;
      }
    }
  }

  const groups = new Map<string, DomainResource[]>();
  for (const r of domainResources) {
    const list = groups.get(r.category) ?? [];
    list.push(r);
    groups.set(r.category, list);
  }

  return [...groups.entries()].map(([category, items]) => ({ category, items }));
}

export async function getResources(
  scriptId: string,
  novelId: string,
): Promise<DomainResources> {
  // Get domain_resources for both scopes, then merge by category
  const [novelGroups, scriptGroups] = await Promise.all([
    getResourcesByScope("novel", novelId),
    getResourcesByScope("script", scriptId),
  ]);

  const merged = new Map<string, DomainResource[]>();
  for (const g of [...novelGroups, ...scriptGroups]) {
    const existing = merged.get(g.category);
    if (existing) {
      existing.push(...g.items);
    } else {
      merged.set(g.category, [...g.items]);
    }
  }

  return {
    categories: [...merged.entries()].map(([category, items]) => ({ category, items })),
  };
}

/* ------------------------------------------------------------------ */
/*  Public API: Resource mutations                                     */
/* ------------------------------------------------------------------ */

/**
 * Update a domain resource's data field (for JSON editor)
 */
export async function updateResourceData(
  id: string,
  data: unknown,
): Promise<void> {
  await prisma.domainResource.update({
    where: { id },
    data: { data: data as Prisma.InputJsonValue },
  });
}

/**
 * Delete a single resource by id
 */
export async function deleteResource(id: string): Promise<void> {
  const resource = await prisma.domainResource.findUnique({
    where: { id },
    select: { keyResourceId: true },
  });

  await prisma.domainResource.delete({ where: { id } });

  // Cascade-cleanup linked KeyResource
  if (resource?.keyResourceId) {
    await prisma.keyResource.delete({ where: { id: resource.keyResourceId } }).catch(() => {
      // Already gone — ignore
    });
  }
}
