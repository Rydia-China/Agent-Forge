/**
 * Built-in Skill: langfuse
 *
 * 标准 SKILL.md 格式（YAML frontmatter + Markdown body）以字符串形式内嵌。
 * 由 builtins/index.ts 统一加载解析。
 */
export const raw = `---
name: langfuse
description: Manage prompt templates via Langfuse. Use when you need to fetch, inspect, or compile prompts for subagent execution.
tags:
  - core
  - prompt
  - langfuse
---
# Langfuse Prompt 管理

## 概述

Langfuse 是外部 prompt 版本管理系统。prompt 模板由运营人员在 Langfuse 控制台维护，本系统通过 MCP tools 读取和编译。

**核心原则：从 Langfuse 获取的 prompt 必须通过 \`subagent__run_text\` 执行，禁止在主控上下文中直接使用。**

## 可用工具

- \`langfuse__list_prompts\` — 列出所有 prompt（名称和元数据，不含内容）
- \`langfuse__get_prompt\` — 获取 prompt 模板原文（含 \`{{variable}}\` 占位符）
- \`langfuse__compile_prompt\` — 获取并编译 prompt（替换变量），返回可直接执行的最终 prompt

## 变量语法

Langfuse prompt 使用 \`{{variableName}}\` 语法标记变量占位符。

模板示例：
\\\`\\\`\\\`
{{style}}，请根据以下剧情生成场景描述：{{scene_description}}
\\\`\\\`\\\`

编译调用：
\\\`\\\`\\\`json
{
  "name": "common__gen_scenery_shot__prompt",
  "variables": {
    "style": "高质量日漫风格，赛璐璐",
    "scene_description": "樱花树下的告别场景"
  }
}
\\\`\\\`\\\`

## Prompt 命名约定

Prompt 名称遵循 \`{workflow}__{step}__{type}\` 格式：

- **workflow**: \`common\`（共用）、\`live2d\`、\`intro\`
- **step**: 步骤名（如 \`gen_scenery_shot\`、\`gen_scene\`）
- **type**: \`prompt\`（文本提示词生成）、\`image\`（图片生成）、\`video\`（视频生成）、\`video_prompt\`（视频提示词生成）

示例：
- \`common__gen_scenery_shot__prompt\` — 空镜提示词生成
- \`live2d__gen_scene__image\` — Live2D 分镜图生成
- \`intro__gen_scene__video_prompt\` — Intro 视频提示词生成

## 典型工作流

1. 调用 \`langfuse__list_prompts\` 发现可用 prompt
2. 调用 \`langfuse__compile_prompt\` 编译（传入变量）
3. 将编译后的 prompt 传给 \`subagent__run_text\` 执行

**不要** 调用 \`langfuse__get_prompt\` 后自行拼接变量。compile_prompt 一步完成，更可靠。

## 约束

- Prompt 内容由运营在 Langfuse 控制台维护，本系统只读不写
- 未编译的变量（\`{{var}}\` 未替换）会原样保留在输出中
- 编译后的 prompt 必须通过 subagent 执行，不要在主控对话中直接使用
`;
