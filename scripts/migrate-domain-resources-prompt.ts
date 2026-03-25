#!/usr/bin/env tsx
/**
 * 数据迁移：从 KeyResourceVersion 回填 prompt 到 domain_resources.data
 *
 * 背景：
 * - VideoDetailDrawer 从 DomainResource.data.prompt 读取
 * - 旧的 generate_image/generate_video 没有保存 prompt 到 data 字段
 * - 这个脚本将从 KeyResourceVersion 表回填 prompt
 */

import { prisma } from "../src/lib/db";
import { bizPool } from "../src/lib/biz-db";
import { resolveTable, GLOBAL_USER } from "../src/lib/biz-db-namespace";

const DOMAIN_RESOURCES_TABLE = "domain_resources";

async function main() {
  console.log("🔄 开始迁移 domain_resources.data.prompt...\n");

  // 1. 获取 domain_resources 的物理表名
  const resolved = await resolveTable(GLOBAL_USER, DOMAIN_RESOURCES_TABLE);
  if (!resolved) {
    throw new Error("domain_resources table not found in BizTableMapping");
  }
  const physicalTable = resolved.physicalName;
  console.log(`📋 物理表名: ${physicalTable}\n`);

  // 2. 查询所有有 key_resource_id 的记录
  const { rows } = await bizPool.query(
    `SELECT id, key_resource_id, media_type, data
     FROM "${physicalTable}"
     WHERE key_resource_id IS NOT NULL`,
  );

  console.log(`📊 找到 ${rows.length} 条有 key_resource_id 的记录\n`);

  if (rows.length === 0) {
    console.log("✅ 没有需要迁移的数据");
    return;
  }

  // 3. 批量查询所有 KeyResource
  const keyResourceIds = rows.map((r: any) => r.key_resource_id);
  const keyResources = await prisma.keyResource.findMany({
    where: { id: { in: keyResourceIds } },
    include: {
      versions: {
        orderBy: { version: "asc" },
      },
    },
  });

  const keyResourceMap = new Map(keyResources.map((kr) => [kr.id, kr]));

  // 4. 逐条更新
  let updatedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const row of rows as Array<{
    id: string;
    key_resource_id: string;
    media_type: string;
    data: any;
  }>) {
    const kr = keyResourceMap.get(row.key_resource_id);
    if (!kr) {
      console.log(`⚠️  跳过: id=${row.id}, key_resource_id=${row.key_resource_id} (KeyResource 不存在)`);
      skippedCount++;
      continue;
    }

    // 找到当前版本
    const currentVersion = kr.versions.find((v) => v.version === kr.currentVersion);
    if (!currentVersion) {
      console.log(`⚠️  跳过: id=${row.id}, KeyResource=${kr.id} (当前版本不存在)`);
      skippedCount++;
      continue;
    }

    const prompt = currentVersion.prompt;
    if (!prompt) {
      console.log(`⚠️  跳过: id=${row.id}, KeyResource=${kr.id} (prompt 为空)`);
      skippedCount++;
      continue;
    }

    // 解析现有 data (可能为 null 或空对象)
    let existingData: any = {};
    if (row.data) {
      if (typeof row.data === "string") {
        try {
          existingData = JSON.parse(row.data);
        } catch {
          existingData = {};
        }
      } else {
        existingData = row.data;
      }
    }

    // 如果已经有 prompt，跳过
    if (existingData.prompt) {
      console.log(`⏭️  跳过: id=${row.id} (已有 prompt)`);
      skippedCount++;
      continue;
    }

    // Merge prompt 到 data
    const newData = {
      ...existingData,
      prompt,
    };

    // 对于视频，如果有 sourceImageUrl（从 refUrls[0] 获取）
    if (row.media_type === "video" && currentVersion.refUrls.length > 0) {
      // 尝试找到第一个图片 URL 作为 sourceImageUrl
      const imageUrl = currentVersion.refUrls.find((url) =>
        /\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(url),
      );
      if (imageUrl && !existingData.sourceImageUrl) {
        newData.sourceImageUrl = imageUrl;
      }
    }

    try {
      await bizPool.query(
        `UPDATE "${physicalTable}" SET data = $1 WHERE id = $2`,
        [JSON.stringify(newData), row.id],
      );
      console.log(`✅ 更新: id=${row.id}, prompt="${prompt.substring(0, 50)}..."`);
      updatedCount++;
    } catch (e) {
      console.error(`❌ 更新失败: id=${row.id}`, e);
      errorCount++;
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log(`📈 迁移完成:`);
  console.log(`   ✅ 成功更新: ${updatedCount} 条`);
  console.log(`   ⏭️  跳过: ${skippedCount} 条`);
  console.log(`   ❌ 失败: ${errorCount} 条`);
  console.log("=".repeat(60));
}

main()
  .catch((e) => {
    console.error("❌ 迁移失败:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await bizPool.end();
  });
