#!/usr/bin/env node
/**
 * 发版数据导入 — 从 data/ 读取 JSON 写入数据库
 *
 * 策略：
 *   - Skills / StylePresets: 全量替换（事务内先清空再写入）
 *   - McpServers: create-if-not-exists（已存在的记录保留不动）
 * 可安全重复执行（幂等），适合放在 docker-entrypoint 中。
 *
 * 用法:
 *   node scripts/db-import.js          # 在容器或本地
 *   pnpm db:import                     # 本地快捷方式
 */

"use strict";

const { PrismaClient } = require("../src/generated/prisma");
const { readFileSync, existsSync } = require("node:fs");
const { resolve } = require("node:path");

const DATA_DIR = resolve(__dirname, "..", "data");
const prisma = new PrismaClient();

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function loadJson(filename) {
  const p = resolve(DATA_DIR, filename);
  if (!existsSync(p)) return [];
  return JSON.parse(readFileSync(p, "utf-8"));
}

/* ------------------------------------------------------------------ */
/*  Import functions                                                   */
/* ------------------------------------------------------------------ */

async function importSkills() {
  const items = loadJson("skills.json");
  if (items.length === 0) return 0;

  // create-if-not-exists：已存在的记录保留不动，仅创建缺失的
  let created = 0;
  for (const item of items) {
    const exists = await prisma.skill.findUnique({ where: { name: item.name } });
    if (exists) continue;

    await prisma.skill.create({
      data: {
        name: item.name,
        tags: item.tags,
        provider: item.provider,
        productionVersion: 1,
        versions: {
          create: {
            version: 1,
            description: item.version.description,
            content: item.version.content,
            metadata: item.version.metadata ?? undefined,
          },
        },
      },
    });
    created++;
  }
  return created;
}

async function importMcpServers() {
  const items = loadJson("mcp-servers.json");
  if (items.length === 0) return 0;

  let created = 0;
  for (const item of items) {
    const exists = await prisma.mcpServer.findUnique({ where: { name: item.name } });
    if (exists) continue;

    await prisma.mcpServer.create({
      data: {
        name: item.name,
        enabled: item.enabled,
        config: item.config ?? undefined,
        productionVersion: 1,
        versions: {
          create: {
            version: 1,
            description: item.version.description,
            code: item.version.code,
          },
        },
      },
    });
    created++;
  }
  return created;
}

async function importStylePresets() {
  const items = loadJson("style-presets.json");
  if (items.length === 0) return 0;

  // create-if-not-exists：已存在的记录保留不动，仅创建缺失的
  let created = 0;
  for (const item of items) {
    const exists = await prisma.stylePreset.findFirst({ where: { name: item.name } });
    if (exists) continue;

    await prisma.stylePreset.create({
      data: {
        name: item.name,
        prompt: item.prompt,
        referenceImageUrl: item.referenceImageUrl ?? null,
      },
    });
    created++;
  }
  return created;
}

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */

async function main() {
  if (!existsSync(DATA_DIR)) {
    console.log("📥 data/ 目录不存在，跳过导入");
    return;
  }

  const skills = await importSkills();
  const mcps = await importMcpServers();
  const styles = await importStylePresets();

  const total = skills + mcps + styles;
  if (total === 0) {
    console.log("📥 数据导入：无数据");
  } else {
    console.log(`📥 数据导入完成：Skills +${skills}, McpServers +${mcps}, StylePresets +${styles}`);
  }
}

main()
  .catch((e) => {
    console.error("⚠️  数据导入失败:", e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
