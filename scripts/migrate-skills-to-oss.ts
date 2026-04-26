#!/usr/bin/env tsx
/**
 * 数据迁移脚本：将现有 Skill + SkillVersion 数据迁移到 OSS
 * 
 * 执行步骤：
 * 1. 读取旧表数据（Skill + SkillVersion）
 * 2. 为每个版本生成 SKILL.md 并上传到 OSS
 * 3. 写入新的 Skill 表（单表设计）
 * 4. 保留原始时间戳
 * 
 * 注意：此脚本假设旧表仍然存在。执行前请备份数据库。
 */

import { PrismaClient } from '@/generated/prisma';
import * as ossService from '@/lib/services/oss-service';
import matter from 'gray-matter';

const prisma = new PrismaClient();

interface OldSkill {
  id: string;
  name: string;
  tags: string[];
  productionVersion: number;
  createdAt: Date;
  updatedAt: Date;
  versions: OldSkillVersion[];
}

interface OldSkillVersion {
  id: string;
  skillId: string;
  version: number;
  description: string;
  content: string;
  metadata: unknown;
  createdAt: Date;
}

function toSkillMd(data: {
  name: string;
  description: string;
  content: string;
  metadata: unknown;
}): string {
  const fm: Record<string, unknown> = {
    name: data.name,
    description: data.description,
  };
  if (data.metadata) {
    fm.metadata = data.metadata;
  }
  return matter.stringify(data.content, fm);
}

async function migrateSkillsToOss() {
  console.log('Starting skill migration to OSS...\n');

  try {
    // 1. 读取旧表数据（使用 raw query 因为旧表结构已不在 schema 中）
    const oldSkills = await prisma.$queryRaw<OldSkill[]>`
      SELECT 
        s.id, s.name, s.tags, s."productionVersion", s."createdAt", s."updatedAt"
      FROM "Skill" s
      ORDER BY s.name
    `;

    console.log(`Found ${oldSkills.length} skills to migrate\n`);

    for (const oldSkill of oldSkills) {
      console.log(`Migrating skill: ${oldSkill.name}`);

      // 获取该 skill 的所有版本
      const oldVersions = await prisma.$queryRaw<OldSkillVersion[]>`
        SELECT 
          id, "skillId", version, description, content, metadata, "createdAt"
        FROM "SkillVersion"
        WHERE "skillId" = ${oldSkill.id}
        ORDER BY version
      `;

      console.log(`  Found ${oldVersions.length} versions`);

      for (const oldVersion of oldVersions) {
        // 2. 生成 OSS key
        const ossKey = `skills/${oldSkill.name}/v${oldVersion.version}.md`;

        // 3. 生成 SKILL.md 内容
        const skillMd = toSkillMd({
          name: oldSkill.name,
          description: oldVersion.description,
          content: oldVersion.content,
          metadata: oldVersion.metadata,
        });

        // 4. 上传到 OSS
        try {
          await ossService.uploadBuffer(
            Buffer.from(skillMd, 'utf-8'),
            `${oldSkill.name}/v${oldVersion.version}.md`,
            'skills'
          );
          console.log(`  ✓ Uploaded to OSS: ${ossKey}`);
        } catch (error) {
          console.error(`  ✗ Failed to upload ${ossKey}:`, error);
          throw error;
        }

        // 5. 写入新表
        try {
          await prisma.skill.create({
            data: {
              name: oldSkill.name,
              version: oldVersion.version,
              description: oldVersion.description,
              tags: oldSkill.tags,
              ossKey,
              isProduction: oldVersion.version === oldSkill.productionVersion,
              metadata: oldVersion.metadata as any,
              createdAt: oldVersion.createdAt,
              updatedAt: oldSkill.updatedAt,
            },
          });
          console.log(`  ✓ Created DB record: v${oldVersion.version} (production: ${oldVersion.version === oldSkill.productionVersion})`);
        } catch (error) {
          console.error(`  ✗ Failed to create DB record for v${oldVersion.version}:`, error);
          throw error;
        }
      }

      console.log(`  ✓ Completed migration for ${oldSkill.name}\n`);
    }

    console.log('\n✅ Migration completed successfully!');
    console.log('\nNext steps:');
    console.log('1. Verify the migrated data');
    console.log('2. Drop old tables: DROP TABLE "SkillVersion"; DROP TABLE "Skill";');
    console.log('3. Run: npx prisma db push (to sync schema)');

  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// 执行迁移
migrateSkillsToOss().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
