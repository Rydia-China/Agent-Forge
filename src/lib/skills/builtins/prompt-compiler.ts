/**
 * Built-in Skill: prompt-compiler
 *
 * 标准 SKILL.md 格式（YAML frontmatter + Markdown body）以字符串形式内嵌。
 * 由 builtins/index.ts 统一加载解析。
 */
export const raw = `---
name: prompt-compiler
provider: local
description: Prompt compilation rules for the video workflow. Style words come from StylePreset DB, prompt assembly is done inline — no external template engine.
tags:
  - core
  - prompt
  - style
requires_mcps:
  - style_preset
---
# Prompt 编译规则

## 核心原则

**StylePreset.prompt 就是完整的 prompt 模板。** 代码只提供数据变量做 \`{{var}}\` 替换，替换后直接就是最终 prompt。

代码中 **禁止硬编码任何 prompt 结构**（风格词、指令语、copyright 等）。所有内容均在 StylePreset DB 中维护。

## StylePreset 管理

通过 \`style_preset\` MCP tools 或 REST API 查看和修改。

6 个内置预设及其可用变量：
- \`portrait-style\` — 角色立绘，变量: \`{{demographics}}\`
- \`update_portrait_style\` — 更新立绘，变量: \`{{demographics}}\`
- \`location_style\` — 单场景图，变量: \`{{name}}\` \`{{scenePrompt}}\`
- \`location_grid_style\` — 宫格图，变量: \`{{name}}\` \`{{gridSize}}\` \`{{gridSlots}}\`
- \`sub_location_style\` — 子场景高清放大，变量: \`{{name}}\` \`{{sceneName}}\`
- \`video_style\` — 视频生成，变量: \`{{shotPrompt}}\` \`{{clipDescription}}\` \`{{referenceInfo}}\`

## 代码对 StylePreset 的约定

代码只做一件事：
\\\`\\\`\\\`
prompt = compileTemplate(style.stylePrompt, { ...variables })
\\\`\\\`\\\`

不做任何额外拼接、不加前缀/后缀、不包装。模板怎么写，输出就是什么。

## Langfuse

Langfuse 仍可用于 prompt 版本管理和浏览（\`langfuse__list_prompts\` / \`langfuse__get_prompts\`），但**不在生产执行路径上**。
`;
