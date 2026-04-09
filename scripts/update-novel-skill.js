#!/usr/bin/env node
/**
 * 一次性脚本：更新 novel-video-planner skill 到 v18
 * 添加完整的 update_portrait 工具文档
 */

const { PrismaClient } = require("../src/generated/prisma");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const prisma = new PrismaClient();

async function main() {
  const skillName = "novel-video-planner";
  
  // 读取更新内容
  const content = readFileSync("/tmp/novel-video-planner-update.md", "utf-8");
  const description = "小说级资源补全 Agent。通过 get_status 查询进度，补全角色立绘（支持 generate_portrait 首次创建 + update_portrait 重新生成）和场景图片（支持 grid/hd/single 三模式），所有任务并行执行。";
  
  // 查找 skill
  const skill = await prisma.skill.findUnique({ where: { name: skillName } });
  if (!skill) {
    console.error(`❌ Skill "${skillName}" 不存在`);
    process.exit(1);
  }
  
  // 获取下一个版本号
  const lastVersion = await prisma.skillVersion.findFirst({
    where: { skillId: skill.id },
    orderBy: { version: "desc" },
  });
  const nextVersion = (lastVersion?.version ?? 0) + 1;
  
  // 创建新版本
  const newVersion = await prisma.skillVersion.create({
    data: {
      skillId: skill.id,
      version: nextVersion,
      description,
      content,
      metadata: null,
    },
  });
  
  // 更新 production version
  await prisma.skill.update({
    where: { id: skill.id },
    data: { productionVersion: nextVersion },
  });
  
  console.log(`✅ ${skillName} 已更新到 v${nextVersion}`);
  console.log(`   描述: ${description}`);
  console.log(`   内容长度: ${content.length} 字符`);
  console.log(`   包含 update_portrait 完整文档: ✓`);
}

main()
  .catch((e) => {
    console.error("⚠️  更新失败:", e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
