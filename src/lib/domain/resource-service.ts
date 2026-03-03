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

  const groups = new Map<string, DomainResource[]>();
  for (const raw of rows as Array<Record<string, unknown>>) {
    const r = toResource(raw);
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
 */
export async function deleteResourcesByScope(
  scopeType: string,
  scopeId: string,
): Promise<void> {
  const t = await physical();
  await bizPool.query(
    `DELETE FROM "${t}" WHERE scope_type = $1 AND scope_id = $2`,
    [scopeType, scopeId],
  );
}

/**
 * Delete a single resource by id.
 * If the resource has a linked KeyResource, cascade-delete it
 * (KeyResourceVersion rows are removed by Prisma onDelete: Cascade).
 */
export async function deleteResource(id: string): Promise<void> {
  const t = await physical();

  // Fetch linked key_resource_id before deleting
  const { rows } = await bizPool.query(
    `SELECT key_resource_id FROM "${t}" WHERE id = $1 LIMIT 1`,
    [id],
  );
  const row = rows[0] as { key_resource_id: string | null } | undefined;
  const linkedId = row?.key_resource_id ?? null;

  // Delete the biz-db row
  await bizPool.query(`DELETE FROM "${t}" WHERE id = $1`, [id]);

  // Cascade-delete linked KeyResource (+ all versions) if present
  if (linkedId) {
    await prisma.keyResource.delete({ where: { id: linkedId } }).catch(() => {
      // KeyResource may already be gone or ID may not match — ignore
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
