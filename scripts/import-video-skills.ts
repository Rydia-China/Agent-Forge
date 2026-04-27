#!/usr/bin/env tsx
/**
 * Import video production skills from temp directory
 */

import * as fs from "fs";
import * as path from "path";
import * as skillService from "../src/lib/services/skill-service";

const TEMP_SKILLS_DIR = "/Users/rydia/Project/mob.ai/git/Agent-Forge/temp/video-agent-test/skills";

interface SkillFile {
  filename: string;
  name: string;
  description: string;
  tags: string[];
}

const SKILLS_TO_IMPORT: SkillFile[] = [
  {
    filename: "WORKFLOW_NEW.md",
    name: "video-workflow",
    description: "Video Agent 新管线工作流 - 测试管线的完整 SOP，用于 EP2/EP11/EP16 复杂场景",
    tags: ["video", "workflow", "seedance"],
  },
  {
    filename: "DIRECTOR_PLAYBOOK.md",
    name: "video-director-playbook",
    description: "Seedance 实测可用的导演原则 - 镜头语言、剧作、声音、色调等导演技巧",
    tags: ["video", "director", "seedance"],
  },
  {
    filename: "SKILL_REVIEWER.md",
    name: "video-skill-reviewer",
    description: "Skill Reviewer - 技能文件质量检测标准，32 项检测清单",
    tags: ["video", "reviewer", "quality"],
  },
  {
    filename: "SEEDANCE_LESSONS.md",
    name: "video-seedance-lessons",
    description: "Seedance 实测经验教训 - 能力档位、反向校准、道具激活、情绪定位等铁律",
    tags: ["video", "seedance", "lessons"],
  },
  {
    filename: "SHOT_ID_POLICY.md",
    name: "video-shot-id-policy",
    description: "Shot ID 命名与素材引用规则 - @图N 顺序、videos 规则、末帧 PNG 标准",
    tags: ["video", "policy", "naming"],
  },
  {
    filename: "CHARACTER_DNA.md",
    name: "video-character-dna",
    description: "角色 DNA 锁定规则 - 服装权威源、立绘映射、弱档属性处理",
    tags: ["video", "character", "dna"],
  },
];

async function importSkills() {
  console.log("Starting skill import...\n");

  for (const skill of SKILLS_TO_IMPORT) {
    const filePath = path.join(TEMP_SKILLS_DIR, skill.filename);
    
    if (!fs.existsSync(filePath)) {
      console.error(`❌ File not found: ${filePath}`);
      continue;
    }

    const content = fs.readFileSync(filePath, "utf-8");
    
    // Create SKILL.md format with frontmatter
    const skillMd = `---
name: ${skill.name}
description: ${skill.description}
---

${content}`;

    try {
      const result = await skillService.importSkill({
        skillMd,
        tags: skill.tags,
      });

      console.log(`✅ Imported: ${skill.name} (v${result.skill.version})`);
    } catch (error) {
      console.error(`❌ Failed to import ${skill.name}:`, error);
    }
  }

  console.log("\n✅ Skill import completed!");
}

importSkills().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
