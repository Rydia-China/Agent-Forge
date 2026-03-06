/**
 * Domain Resource Service — generic CRUD for the domain_resources table.
 *
 * No business concepts (characters, costumes, scenes, shots) — only
 * scope, category, and media_type.
 */

import { bizPool } from "@/lib/biz-db";
import { resolveTable, GLOBAL_USER } from "@/lib/biz-db-namespace";
import { ensureDomainResourcesTable, DOMAIN_RESOURCES_TABLE } from "./resource-schema";
import { prisma } from "@/lib/db";

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
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

async function physical(): Promise<string> {
  await ensureDomainResourcesTable();
  const resolved = await resolveTable(GLOBAL_USER, DOMAIN_RESOURCES_TABLE);
  if (!resolved) throw new Error("domain_resources table not found in BizTableMapping");
  return resolved.physicalName;
}

function toResource(row: Record<string, unknown>): DomainResource {
  return {
    id: row.id as string,
    category: row.category as string,
    mediaType: row.media_type as string,
    title: (row.title as string | null) ?? null,
    url: (row.url as string | null) ?? null,
    data: row.data ?? null,
    keyResourceId: (row.key_resource_id as string | null) ?? (row.image_gen_id as string | null) ?? null,
    sortOrder: (row.sort_order as number) ?? 0,
  };
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
  const t = await physical();
  const { rows } = await bizPool.query(
    `SELECT * FROM "${t}"
     WHERE scope_type = $1 AND scope_id = $2
     ORDER BY category, sort_order, created_at`,
    [scopeType, scopeId],
  );

  const resources = (rows as Array<Record<string, unknown>>).map(toResource);

  // Collect linked KeyResource IDs to resolve current-version URLs in a single query
  const linkedIds = resources
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
    for (const r of resources) {
      if (r.keyResourceId && urlMap.has(r.keyResourceId)) {
        r.url = urlMap.get(r.keyResourceId) ?? r.url;
      }
    }
  }

  const groups = new Map<string, DomainResource[]>();
  for (const r of resources) {
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
  const t = await physical();
  const { rows } = await bizPool.query(
    `SELECT url FROM "${t}"
     WHERE scope_type = $1 AND scope_id = $2
       AND url IS NOT NULL`,
    [scopeType, scopeId],
  );
  const urls = new Set<string>();
  for (const row of rows as Array<{ url: string }>) {
    urls.add(row.url);
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
  const t = await physical();
  const { rows } = await bizPool.query(
    `INSERT INTO "${t}"
       (scope_type, scope_id, category, media_type, title, url, data, key_resource_id, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [
      input.scopeType,
      input.scopeId,
      input.category,
      input.mediaType,
      input.title ?? null,
      input.url ?? null,
      input.data != null ? JSON.stringify(input.data) : null,
      input.keyResourceId ?? null,
      input.sortOrder ?? 0,
    ],
  );
  return (rows[0] as { id: string }).id;
}

/**
 * Upsert a resource by keyResourceId — if a row with the same key_resource_id
 * already exists in the same scope, update it; otherwise insert.
 */
export async function upsertByKeyResource(input: CreateResourceInput & { keyResourceId: string }): Promise<string> {
  const t = await physical();
  const { rows: existing } = await bizPool.query(
    `SELECT id FROM "${t}"
     WHERE scope_type = $1 AND scope_id = $2 AND key_resource_id = $3
     LIMIT 1`,
    [input.scopeType, input.scopeId, input.keyResourceId],
  );
  if ((existing as Array<{ id: string }>).length > 0) {
    const id = (existing[0] as { id: string }).id;
    await bizPool.query(
      `UPDATE "${t}"
       SET category = $1, title = $2, url = $3, data = $4, sort_order = $5
       WHERE id = $6`,
      [
        input.category,
        input.title ?? null,
        input.url ?? null,
        input.data != null ? JSON.stringify(input.data) : null,
        input.sortOrder ?? 0,
        id,
      ],
    );
    return id;
  }
  return createResource(input);
}

/**
 * Delete all resources for a given scope (used when deleting an episode).
 * Cascade-deletes linked KeyResources, nulls dangling refs,
 * then notifies registered cleanup hooks.
 */
export async function deleteResourcesByScope(
  scopeType: string,
  scopeId: string,
): Promise<void> {
  const t = await physical();

  // 1. Collect full info before deleting (for hooks + KeyResource cascade)
  const { rows } = await bizPool.query(
    `SELECT scope_type, scope_id, media_type, title, url, key_resource_id
     FROM "${t}" WHERE scope_type = $1 AND scope_id = $2`,
    [scopeType, scopeId],
  );
  const deleted: DeletedResourceInfo[] = (rows as Array<Record<string, unknown>>).map((r) => ({
    scopeType: r.scope_type as string,
    scopeId: r.scope_id as string,
    mediaType: r.media_type as string,
    title: (r.title as string | null) ?? null,
    url: (r.url as string | null) ?? null,
    keyResourceId: (r.key_resource_id as string | null) ?? null,
  }));
  const keyResourceIds = deleted
    .map((d) => d.keyResourceId)
    .filter((id): id is string => id != null);

  // 2. Delete the biz-db rows
  await bizPool.query(
    `DELETE FROM "${t}" WHERE scope_type = $1 AND scope_id = $2`,
    [scopeType, scopeId],
  );

  // 3. Cascade-cleanup linked KeyResources
  await cascadeDeleteKeyResources(t, keyResourceIds);

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
 * Cascade-deletes linked KeyResource, nulls dangling refs,
 * then notifies registered cleanup hooks.
 */
export async function deleteResource(id: string): Promise<DeletedResourceInfo | null> {
  const t = await physical();

  // 1. Fetch full row before deleting
  const { rows } = await bizPool.query(
    `SELECT scope_type, scope_id, media_type, title, url, key_resource_id
     FROM "${t}" WHERE id = $1 LIMIT 1`,
    [id],
  );
  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;

  const info: DeletedResourceInfo = {
    scopeType: row.scope_type as string,
    scopeId: row.scope_id as string,
    mediaType: row.media_type as string,
    title: (row.title as string | null) ?? null,
    url: (row.url as string | null) ?? null,
    keyResourceId: (row.key_resource_id as string | null) ?? null,
  };

  // 2. Delete the biz-db row
  await bizPool.query(`DELETE FROM "${t}" WHERE id = $1`, [id]);

  // 3. Cascade-cleanup linked KeyResource
  if (info.keyResourceId) {
    await cascadeDeleteKeyResources(t, [info.keyResourceId]);
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
  physicalTable: string,
  keyResourceIds: string[],
): Promise<void> {
  if (keyResourceIds.length === 0) return;

  // Null out key_resource_id in any other domain_resources rows
  // that still reference these KeyResources
  await bizPool.query(
    `UPDATE "${physicalTable}"
     SET key_resource_id = NULL
     WHERE key_resource_id = ANY($1::text[])`,
    [keyResourceIds],
  );

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
  const t = await physical();
  await bizPool.query(
    `UPDATE "${t}" SET data = $1 WHERE id = $2`,
    [JSON.stringify(data), id],
  );
}
