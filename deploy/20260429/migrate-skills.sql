-- 为现有 Skill 记录添加新字段的默认值
-- 执行前确保已备份数据库

BEGIN;

-- 1. 添加字段（允许 NULL）
ALTER TABLE "Skill" ADD COLUMN IF NOT EXISTS "version" INTEGER;
ALTER TABLE "Skill" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "Skill" ADD COLUMN IF NOT EXISTS "ossKey" TEXT;
ALTER TABLE "Skill" ADD COLUMN IF NOT EXISTS "isProduction" BOOLEAN DEFAULT false;
ALTER TABLE "Skill" ADD COLUMN IF NOT EXISTS "tags" TEXT[] DEFAULT '{}';
ALTER TABLE "Skill" ADD COLUMN IF NOT EXISTS "metadata" JSONB;

-- 2. 为现有记录填充默认值
UPDATE "Skill" SET
  "version" = 1,
  "description" = COALESCE("description", name || ' - legacy skill migrated from old schema'),
  "ossKey" = COALESCE("ossKey", 'skills/' || name || '/v1.md'),
  "isProduction" = COALESCE("isProduction", true),
  "tags" = COALESCE("tags", ARRAY['legacy']::TEXT[])
WHERE "version" IS NULL;

-- 3. 设置字段为 NOT NULL
ALTER TABLE "Skill" ALTER COLUMN "version" SET NOT NULL;
ALTER TABLE "Skill" ALTER COLUMN "description" SET NOT NULL;
ALTER TABLE "Skill" ALTER COLUMN "ossKey" SET NOT NULL;

-- 4. 添加唯一约束和索引（忽略已存在的错误）
DO $$
BEGIN
  ALTER TABLE "Skill" ADD CONSTRAINT "Skill_ossKey_key" UNIQUE ("ossKey");
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "Skill" ADD CONSTRAINT "Skill_name_version_key" UNIQUE ("name", "version");
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "Skill_name_isProduction_idx" ON "Skill"("name", "isProduction");
CREATE INDEX IF NOT EXISTS "Skill_tags_idx" ON "Skill" USING GIN("tags");

COMMIT;
