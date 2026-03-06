/**
 * Generic biz-table cleanup — registered as a post-delete hook.
 *
 * When domain_resources are deleted, any biz table may hold denormalized
 * copies of the URL or keyResourceId in text columns. This module scans
 * ALL biz tables (auto-discovered via BizTableMapping) and nulls out
 * exact matches. No table names or column names are hardcoded.
 */

import { bizPool } from "@/lib/biz-db";
import { prisma } from "@/lib/db";
import { GLOBAL_USER } from "@/lib/biz-db-namespace";
import { onResourceDeleted } from "./resource-service";
import { DOMAIN_RESOURCES_TABLE } from "./resource-schema";

onResourceDeleted(async (deleted) => {
  // Collect all unique text values that might be denormalized elsewhere
  const values = new Set<string>();
  for (const d of deleted) {
    if (d.url) values.add(d.url);
    if (d.keyResourceId) values.add(d.keyResourceId);
  }
  if (values.size === 0) return;

  // Discover all biz tables (excluding domain_resources itself)
  const mappings = await prisma.bizTableMapping.findMany({
    where: {
      userName: GLOBAL_USER,
      NOT: { logicalName: DOMAIN_RESOURCES_TABLE },
    },
    select: { physicalName: true },
  });

  const valArr = [...values];

  for (const { physicalName } of mappings) {
    // Introspect text columns
    const { rows: cols } = await bizPool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 AND data_type = 'text'`,
      [physicalName],
    );

    for (const col of cols as Array<{ column_name: string }>) {
      // Exact-match only — safe for URL/ID columns,
      // won't touch long-text fields that merely mention a URL.
      await bizPool.query(
        `UPDATE "${physicalName}" SET "${col.column_name}" = NULL
         WHERE "${col.column_name}" = ANY($1::text[])`,
        [valArr],
      );
    }
  }
});
