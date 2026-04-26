/**
 * 内置 Skill 初始化模块
 * 
 * 系统启动时自动检查并初始化预置 skill：
 * 1. 从代码中读取 builtin skill 定义
 * 2. 检查 DB 中是否已存在
 * 3. 不存在则上传到 OSS + 写入 DB
 * 4. 已存在则跳过（用户可能已修改）
 */

import { prisma } from "@/lib/db";
import * as ossService from "@/lib/services/oss-service";
import { listBuiltinSkills } from "@/lib/skills/builtins";
import { toSkillMd } from "@/lib/services/skill-service";
import type { Prisma } from "@/generated/prisma";

export async function initializeBuiltinSkills(): Promise<void> {
  console.log("[Skill Init] Starting builtin skills initialization...");

  const builtins = listBuiltinSkills();
  console.log(`[Skill Init] Found ${builtins.length} builtin skills to check`);

  let initialized = 0;
  let skipped = 0;

  for (const builtin of builtins) {
    try {
      // Check if skill already exists in DB
      const existing = await prisma.skill.findFirst({
        where: { name: builtin.name },
      });

      if (existing) {
        console.log(`[Skill Init] ✓ Skill "${builtin.name}" already exists, skipping`);
        skipped++;
        continue;
      }

      // Initialize new builtin skill
      const version = 1;
      const ossKey = `skills/${builtin.name}/v${version}.md`;

      // Generate SKILL.md content
      const skillMd = toSkillMd({
        name: builtin.name,
        description: builtin.description,
        content: builtin.content,
        metadata: null,
      });

      // Upload to OSS
      await ossService.uploadBuffer(
        Buffer.from(skillMd, "utf-8"),
        `${builtin.name}/v${version}.md`,
        "skills"
      );

      // Write to DB
      await prisma.skill.create({
        data: {
          name: builtin.name,
          version,
          description: builtin.description,
          tags: [...builtin.tags],
          ossKey,
          isProduction: true,
          metadata: undefined,
        },
      });

      console.log(`[Skill Init] ✓ Initialized builtin skill: ${builtin.name}`);
      initialized++;
    } catch (error) {
      console.error(`[Skill Init] ✗ Failed to initialize skill "${builtin.name}":`, error);
      // Continue with other skills even if one fails
    }
  }

  console.log(`[Skill Init] Completed: ${initialized} initialized, ${skipped} skipped`);
}
