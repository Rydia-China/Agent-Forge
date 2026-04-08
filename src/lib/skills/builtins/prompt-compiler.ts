/**
 * Built-in Skill: langfuse
 *
 * 标准 SKILL.md 格式（YAML frontmatter + Markdown body）以字符串形式内嵌。
 * 由 builtins/index.ts 统一加载解析。
 */
export const raw = `---
name: prompt-compiler
provider: langfuse
description: Fetch and compile prompt templates from Langfuse with variable substitution. Use when you need to prepare prompts for subagent execution or inspect available prompt templates.
tags:
  - core
  - prompt
  - langfuse
requires_mcps:
  - langfuse
  - langfuse_admin
---
# Langfuse Prompt 管理

## 概述

Langfuse 是外部 prompt 版本管理系统。prompt 模板由运营人员在 Langfuse 控制台维护，本系统通过 MCP tools 读取和编译。

**核心原则：从 Langfuse 获取的 prompt 必须通过 \`subagent__run_text\` 执行，禁止在主控上下文中直接使用。**

## 可用工具

- \`langfuse__list_prompts\` — 列出所有 prompt（名称和元数据，不含内容）
- \`langfuse__get_prompts\` — 获取 prompt 模板原文（含 \`{{variable}}\` 占位符），支持批量
- \`langfuse__compile_prompts\` — 获取并编译 prompt（替换变量），返回可直接执行的最终 prompt，支持批量

## 变量语法

Langfuse prompt 使用 \`{{variableName}}\` 语法标记变量占位符。

**重要：风格词、比例、约束等全部由 Langfuse 模板控制，禁止在代码或对话中硬编码任何风格词。**

编译调用示例：
\\\`\\\`\\\`json
{
  "name": "common__gen_scenery_shot__image",
  "variables": {
    "style": "<风格词>",
    "scenePrompt": "<场景视觉描述>"
  }
}
\\\`\\\`\\\`

## Prompt 命名约定

Prompt 名称遵循 \`{workflow}__{step}__{type}\` 格式：

- **workflow**: \`common\`（共用）、\`live2d\`、\`intro\`
- **step**: 步骤名（如 \`gen_scenery_shot\`、\`gen_scene\`）
- **type**: \`image\`（图片生成）、\`video\`（视频生成）、\`video_prompt\`（视频提示词生成）

示例：
- \`common__gen_scenery_shot__image\` — 空镜图片生成
- \`live2d__gen_scene__image\` — Live2D 分镜图生成
- \`intro__gen_scene__video_prompt\` — Intro 视频提示词生成

**禁止猜测 prompt 名称** — 必须先通过 \`langfuse__list_prompts\` 或 \`langfuse__get_prompts\` 确认实际存在的名称。

## 典型工作流

1. 调用 \`langfuse__list_prompts\` 发现可用 prompt
2. 调用 \`langfuse__get_prompts\` 查看模板原文，确认实际变量名
3. 调用 \`langfuse__compile_prompts\` 编译（传入变量数组）
4. 将编译后的 prompt 传给 \`subagent__run_text\` 执行

**禁止猜测变量名** — 必须先通过 \`get_prompts\` 查看实际模板，确认 \`{{variable}}\` 名称后再调用 compile_prompts。
**禁止硬编码风格词** — 风格词由运营在 Langfuse 控制台维护，代码和对话中不得出现任何风格词字面量。

## 约束

- Prompt 内容由运营在 Langfuse 控制台维护，本系统只读不写
- 未编译的变量（\`{{var}}\` 未替换）会原样保留在输出中
- 编译后的 prompt 必须通过 subagent 执行，不要在主控对话中直接使用
`;
