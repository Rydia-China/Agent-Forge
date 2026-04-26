/**
 * Domain Resource Service — generic CRUD for the DomainResource table.
 *
 * No business concepts (characters, costumes, scenes, shots) — only
 * scope, category, and media_type.
 */

import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface DomainResource {
  id: string;
  category: string;
  mediaType: string;
  title: string | null;
  url: string | null;
  data: unknown;
  keyResourceId: string | null;
  sortOrder: number;
}

export interface CategoryGroup {
  category: string;
  items: DomainResource[];
}

export interface DomainResources {
  categories: CategoryGroup[];
}

/* ------------------------------------------------------------------ */
/*  Query                                                              */
/* ------------------------------------------------------------------ */

/**
 * Get all resources for a given scope, grouped by category.
 * When a resource is linked to a KeyResource (keyResourceId), resolve
 * the URL from the KeyResource's current version so the panel always
 * reflects the active version (after rollback / regenerate).
 */
export async function getResourcesByScope(
  scopeType: string,
  scopeId: string,
): Promise<CategoryGroup[]> {
  const resources = await prisma.domainResource.findMany({
    where: { scopeType, scopeId },
    orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
  });

  const domainResources: DomainResource[] = resources.map((r) => ({
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
      const curVer = kr.versions.find((v) => v.version === kr.currentVersion);
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

/**
 * Collect all known image/video URLs from domain_resources for de-duplication
 * against KeyResource "other images".
 */
export async function collectKnownUrls(
  scopeType: string,
  scopeId: string,
): Promise<Set<string>> {
  const resources = await prisma.domainResource.findMany({
    where: { scopeType, scopeId, url: { not: null } },
    select: { url: true },
  });
  const urls = new Set<string>();
  for (const resource of resources) {
    if (resource.url) urls.add(resource.url);
  }
  return urls;
}

/* ------------------------------------------------------------------ */
/*  Mutate                                                             */
/* ------------------------------------------------------------------ */

export interface CreateResourceInput {
  scopeType: string;
  scopeId: string;
  category: string;
  mediaType: string;
  title?: string;
  url?: string;
  data?: unknown;
  keyResourceId?: string;
  sortOrder?: number;
}

/**
 * Insert a new resource into domain_resources.
 * Returns the generated UUID.
 */
export async function createResource(input: CreateResourceInput): Promise<string> {
  const resource = await prisma.domainResource.create({
    data: {
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      category: input.category,
      mediaType: input.mediaType,
      title: input.title ?? null,
      url: input.url ?? null,
      data: input.data as Prisma.InputJsonValue,
      keyResourceId: input.keyResourceId ?? null,
      sortOrder: input.sortOrder ?? 0,
    },
  });
  return resource.id;
}

/**
 * Upsert a resource by keyResourceId — if a row with the same key_resource_id
 * already exists in the same scope, update it; otherwise insert.
 */
export async function upsertByKeyResource(input: CreateResourceInput & { keyResourceId: string }): Promise<string> {
  const existing = await prisma.domainResource.findFirst({
    where: {
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      keyResourceId: input.keyResourceId,
    },
  });

  if (existing) {
    await prisma.domainResource.update({
      where: { id: existing.id },
      data: {
        category: input.category,
        title: input.title ?? null,
        url: input.url ?? null,
        data: input.data as Prisma.InputJsonValue,
        sortOrder: input.sortOrder ?? 0,
      },
    });
    return existing.id;
  }

  return createResource(input);
}

/**
 * Delete all resources for a given scope (used when deleting an episode).
 * Cascade-deletes linked KeyResources, then notifies registered cleanup hooks.
 */
export async function deleteResourcesByScope(
  scopeType: string,
  scopeId: string,
): Promise<void> {
  // 1. Collect full info before deleting (for hooks + KeyResource cascade)
  const resources = await prisma.domainResource.findMany({
    where: { scopeType, scopeId },
    select: {
      scopeType: true,
      scopeId: true,
      mediaType: true,
      title: true,
      url: true,
      keyResourceId: true,
    },
  });

  const deleted: DeletedResourceInfo[] = resources.map((r) => ({
    scopeType: r.scopeType,
    scopeId: r.scopeId,
    mediaType: r.mediaType,
    title: r.title,
    url: r.url,
    keyResourceId: r.keyResourceId,
  }));

  const keyResourceIds = deleted
    .map((d) => d.keyResourceId)
    .filter((id): id is string => id != null);

  // 2. Delete the Prisma rows
  await prisma.domainResource.deleteMany({
    where: { scopeType, scopeId },
  });

  // 3. Cascade-cleanup linked KeyResources
  await cascadeDeleteKeyResources(keyResourceIds);

  // 4. Notify hooks
  await notifyDeleteHooks(deleted);
}

export interface DeletedResourceInfo {
  scopeType: string;
  scopeId: string;
  mediaType: string;
  title: string | null;
  url: string | null;
  keyResourceId: string | null;
}

/* ------------------------------------------------------------------ */
/*  Post-delete hook — business layers register cleanup here           */
/* ------------------------------------------------------------------ */

export type ResourceDeletedHook = (deleted: DeletedResourceInfo[]) => Promise<void>;

const deleteHooks: ResourceDeletedHook[] = [];

/**
 * Register a hook that runs after domain_resources are deleted.
 * Hooks receive the metadata of all deleted rows so they can clean up
 * denormalized copies in business tables.
 */
export function onResourceDeleted(hook: ResourceDeletedHook): void {
  deleteHooks.push(hook);
}

async function notifyDeleteHooks(deleted: DeletedResourceInfo[]): Promise<void> {
  if (deleted.length === 0) return;
  for (const hook of deleteHooks) {
    try {
      await hook(deleted);
    } catch (e) {
      console.error("[resource-service] cleanup hook error:", e);
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Delete                                                             */
/* ------------------------------------------------------------------ */

/**
 * Delete a single resource by id.
 * Cascade-deletes linked KeyResource, then notifies registered cleanup hooks.
 */
export async function deleteResource(id: string): Promise<DeletedResourceInfo | null> {
  // 1. Fetch full row before deleting
  const resource = await prisma.domainResource.findUnique({
    where: { id },
    select: {
      scopeType: true,
      scopeId: true,
      mediaType: true,
      title: true,
      url: true,
      keyResourceId: true,
    },
  });

  if (!resource) return null;

  const info: DeletedResourceInfo = {
    scopeType: resource.scopeType,
    scopeId: resource.scopeId,
    mediaType: resource.mediaType,
    title: resource.title,
    url: resource.url,
    keyResourceId: resource.keyResourceId,
  };

  // 2. Delete the Prisma row
  await prisma.domainResource.delete({ where: { id } });

  // 3. Cascade-cleanup linked KeyResource
  if (info.keyResourceId) {
    await cascadeDeleteKeyResources([info.keyResourceId]);
  }

  // 4. Notify hooks
  await notifyDeleteHooks([info]);

  return info;
}

/**
 * Cascade-delete KeyResources and null out any remaining domain_resources
 * references that point to them.
 */
async function cascadeDeleteKeyResources(
  keyResourceIds: string[],
): Promise<void> {
  if (keyResourceIds.length === 0) return;

  // Null out keyResourceId in any other domain_resources rows
  // that still reference these KeyResources
  await prisma.domainResource.updateMany({
    where: { keyResourceId: { in: keyResourceIds } },
    data: { keyResourceId: null },
  });

  // Delete the KeyResources themselves (versions cascade via Prisma FK)
  for (const krId of keyResourceIds) {
    await prisma.keyResource.delete({ where: { id: krId } }).catch(() => {
      // Already gone — ignore
    });
  }
}

/**
 * Update the `data` JSONB field of a resource (for JSON editor).
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
