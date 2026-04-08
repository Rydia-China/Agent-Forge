#!/usr/bin/env tsx
/**
 * 发版数据导出 — 导出 Skill、McpServer、StylePreset 到 data/ 目录
 *
 * 只导出 production 版本的内容，格式为自包含 JSON（无需版本引用）。
 * 用法: pnpm db:export
 */

import { prisma } from "../src/lib/db";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = resolve(fileURLToPath(import.meta.url), "..");
const PROJECT_DIR = resolve(__dirname, "..");
const DATA_DIR = resolve(PROJECT_DIR, "data");

/* ------------------------------------------------------------------ */
/*  Export types                                                       */
/* ------------------------------------------------------------------ */

interface ExportedSkill {
  name: string;
  tags: string[];
  provider: string;
  productionVersion: number;
  version: {
    version: number;
    description: string;
    content: string;
    metadata: unknown;
  };
}

interface ExportedMcpServer {
  name: string;
  enabled: boolean;
  config: unknown;
  productionVersion: number;
  version: {
    version: number;
    description: string | null;
    code: string;
  };
}

interface ExportedStylePreset {
  name: string;
  prompt: string;
  referenceImageUrl: string | null;
}

/* ------------------------------------------------------------------ */
/*  Export functions                                                    */
/* ------------------------------------------------------------------ */

async function exportSkills(): Promise<ExportedSkill[]> {
  const skills = await prisma.skill.findMany({
    include: { versions: true },
    orderBy: { name: "asc" },
  });

  const result: ExportedSkill[] = [];
  for (const s of skills) {
    const prodVer = s.versions.find((v) => v.version === s.productionVersion);
    if (!prodVer) {
      console.warn(`⚠️  Skill "${s.name}" 没有找到 production version ${s.productionVersion}，跳过`);
      continue;
    }
    result.push({
      name: s.name,
      tags: s.tags,
      provider: s.provider,
      productionVersion: s.productionVersion,
      version: {
        version: prodVer.version,
        description: prodVer.description,
        content: prodVer.content,
        metadata: prodVer.metadata,
      },
    });
  }
  return result;
}

async function exportMcpServers(): Promise<ExportedMcpServer[]> {
  const servers = await prisma.mcpServer.findMany({
    include: { versions: true },
    orderBy: { name: "asc" },
  });

  const result: ExportedMcpServer[] = [];
  for (const s of servers) {
    const prodVer = s.versions.find((v) => v.version === s.productionVersion);
    if (!prodVer) {
      console.warn(`⚠️  McpServer "${s.name}" 没有找到 production version ${s.productionVersion}，跳过`);
      continue;
    }
    result.push({
      name: s.name,
      enabled: s.enabled,
      config: s.config,
      productionVersion: s.productionVersion,
      version: {
        version: prodVer.version,
        description: prodVer.description,
        code: prodVer.code,
      },
    });
  }
  return result;
}

async function exportStylePresets(): Promise<ExportedStylePreset[]> {
  const presets = await prisma.stylePreset.findMany({
    orderBy: { name: "asc" },
  });
  return presets.map((p) => ({
    name: p.name,
    prompt: p.prompt,
    referenceImageUrl: p.referenceImageUrl,
  }));
}

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */

async function main() {
  mkdirSync(DATA_DIR, { recursive: true });

  const skills = await exportSkills();
  const skillsPath = resolve(DATA_DIR, "skills.json");
  writeFileSync(skillsPath, JSON.stringify(skills, null, 2) + "\n");
  console.log(`✅ Skills: ${skills.length} 条 → data/skills.json`);

  const mcpServers = await exportMcpServers();
  const mcpPath = resolve(DATA_DIR, "mcp-servers.json");
  writeFileSync(mcpPath, JSON.stringify(mcpServers, null, 2) + "\n");
  console.log(`✅ McpServers: ${mcpServers.length} 条 → data/mcp-servers.json`);

  const stylePresets = await exportStylePresets();
  const stylesPath = resolve(DATA_DIR, "style-presets.json");
  writeFileSync(stylesPath, JSON.stringify(stylePresets, null, 2) + "\n");
  console.log(`✅ StylePresets: ${stylePresets.length} 条 → data/style-presets.json`);

  console.log(`\n📦 导出完成，共 ${skills.length + mcpServers.length + stylePresets.length} 条记录`);
}

main()
  .catch((e) => {
    console.error("❌ 导出失败:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
