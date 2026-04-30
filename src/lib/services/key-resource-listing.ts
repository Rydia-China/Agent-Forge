/**
 * KeyResource listing — category-grouped resource queries.
 *
 * Single source of truth: KeyResource + KeyResourceVersion.
 * Used by the video workflow to render resource panels from versioned resources.
 */

import { prisma } from "@/lib/db";
import { listContainerParentSingleSceneKeys } from "@/lib/services/resource-inference-service";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface ResourceItem {
  id: string;
  keyResourceId: string;
  key: string;
  category: string;
  mediaType: string;
  title: string | null;
  url: string | null;
  data: unknown;
  prompt: string | null;
  refUrls: string[];
  currentVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

function isPlainJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergePromptFieldsIntoData(
  data: unknown,
  prompt: string | null,
  refUrls: string[] | null,
): unknown {
  if (data == null && prompt == null && refUrls == null) return null;
  const cloned = data == null ? {} : JSON.parse(JSON.stringify(data));
  if (!isPlainJsonObject(cloned)) return cloned;
  return {
    ...cloned,
    ...(prompt != null ? { prompt } : {}),
    ...(refUrls != null ? { refUrls } : {}),
  };
}

export interface ResourceCategoryGroup {
  category: string;
  items: ResourceItem[];
}

interface ResourceListRow {
  id: string;
  key: string;
  category: string | null;
  mediaType: string;
  title: string | null;
  currentVersion: number;
  createdAt: Date;
  updatedAt: Date;
  versionTitle: string | null;
  url: string | null;
  data: unknown;
  prompt: string | null;
  refUrls: string[] | null;
}

/* ------------------------------------------------------------------ */
/*  Query: list by scope, grouped by category                          */
/* ------------------------------------------------------------------ */

/**
 * List all KeyResources for a given scope, grouped by category.
 * Returns only resources that have a category set.
 *
 * Use raw SQL instead of Prisma model args for category/title compatibility.
 * Dev servers may keep an older generated Prisma Client loaded across schema
 * updates; touching newly added fields through Prisma DMMF would fail before
 * the caller can recover.
 * URL is resolved from the current version.
 */
export async function listResourcesByScope(
  scopeType: string,
  scopeId: string,
): Promise<ResourceCategoryGroup[]> {
  const containerParentSingleSceneKeys = scopeType === "novel"
    ? await listContainerParentSingleSceneKeys(scopeId)
    : new Set<string>();
  const resources = await prisma.$queryRaw<ResourceListRow[]>`
    SELECT
      kr.id,
      kr.key,
      kr.category,
      kr."mediaType",
      kr.title,
      kr."currentVersion",
      kr."createdAt",
      kr."updatedAt",
      krv.title AS "versionTitle",
      krv.url,
      krv.data,
      krv.prompt,
      krv."refUrls"
    FROM "KeyResource" kr
    LEFT JOIN "KeyResourceVersion" krv
      ON krv."keyResourceId" = kr.id
     AND krv.version = kr."currentVersion"
    WHERE kr."scopeType" = ${scopeType}
      AND kr."scopeId" = ${scopeId}
      AND kr.category IS NOT NULL
    ORDER BY kr.category ASC, kr."createdAt" ASC
  `;

  const groups = new Map<string, ResourceItem[]>();

  for (const resource of resources) {
    if (!resource.category) continue;
    if (
      resource.category === "场景"
      && containerParentSingleSceneKeys.has(resource.key)
    ) {
      continue;
    }

    const item: ResourceItem = {
      id: resource.id,
      keyResourceId: resource.id,
      key: resource.key,
      category: resource.category,
      mediaType: resource.mediaType,
      title: resource.title ?? resource.versionTitle,
      url: resource.url,
      data: resource.mediaType === "json"
        ? mergePromptFieldsIntoData(resource.data, resource.prompt, resource.refUrls)
        : null,
      prompt: resource.prompt,
      refUrls: resource.refUrls ?? [],
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
