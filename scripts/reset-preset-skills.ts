#!/usr/bin/env tsx
/**
 * 删除并重建所有预置 skills
 * 
 * 用途：当预置 skills 的定义（如 description）更新后，删除数据库中的旧记录并重新初始化
 * 
 * 警告：此操作会删除所有预置 skills 的数据库记录
 * 用户对这些 skills 的修改将丢失（如果有）
 * 
 * 注意：OSS 中的旧文件不会被删除，会自然过期或需要手动清理
 */

import { prisma } from "../src/lib/db";
import { initializePresetSkills } from "../src/lib/skills/init-presets";
import { listPresetSkills } from "../src/lib/skills/presets";

async function main() {
  console.log("[Reset] Starting preset skills reset...");

  const presets = listPresetSkills();
  const presetNames = presets.map((p) => p.name);

  console.log(`[Reset] Found ${presetNames.length} preset skills to reset`);
  console.log(`[Reset] Preset names: ${presetNames.join(", ")}`);

  // 1. 删除数据库中的所有预置 skills
  console.log("\n[Reset] Step 1: Deleting preset skills from database...");
  const deleteResult = await prisma.skill.deleteMany({
    where: {
      name: {
        in: presetNames,
      },
    },
  });
  console.log(`[Reset] Deleted ${deleteResult.count} skill records from database`);

  // 2. 重新初始化预置 skills
  console.log("\n[Reset] Step 2: Re-initializing preset skills...");
  await initializePresetSkills();

  console.log("\n[Reset] ✓ Preset skills reset completed successfully!");
  console.log("[Reset] Note: Old OSS files are not deleted and may need manual cleanup");
}

main()
  .catch((error) => {
    console.error("[Reset] ✗ Fatal error:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
