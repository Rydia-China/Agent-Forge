/**
 * Built-in Skill: skill-creator
 *
 * 标准 SKILL.md 格式（YAML frontmatter + Markdown body）以字符串形式内嵌。
 * 由 builtins/index.ts 统一加载解析。
 */
export const raw = `---
name: skill-creator
description: Create high-quality Agent Skills for this system. Use when asked to create, design, or improve a skill.
tags:
  - meta
  - core
---
# Skill Creator

## What is a Skill

Skill 是一段结构化的知识文档，遵循 Agent Skills 开放标准 (agentskills.io)。
在本系统中，Skill 存储在数据库中，包含以下字段：

- **name** — 唯一标识符，kebab-case（如 \`git-commit-conventions\`）
- **description** — 一句话描述用途和触发时机，会注入 system prompt，决定 agent 何时使用该 skill
- **content** — Markdown 正文，包含 agent 执行任务的完整指令
- **tags** — 分类标签数组，用于检索和分组

## 设计原则

### Description 决定触发

Agent 的 system prompt 中只包含 name + description 索引。
description 必须清晰回答两个问题：
1. 这个 skill 做什么？
2. 什么时候应该使用它？

好的 description 示例：
- "Guide for writing conventional Git commit messages. Use when committing code or reviewing commit history."
- "Create dynamic MCP servers for this system's sandbox. Use when asked to build integrations or tools."

差的 description：
- "Helps with Git stuff"（太模糊，agent 无法判断何时触发）

### Content 按需加载

Agent 看到 description 判断相关后，才通过 \`skills__get\` 读取全文。
因此 content 可以很长，但应结构良好、易于扫描：

1. **概述** — 简短说明 skill 目标
2. **步骤** — 按顺序列出执行步骤
3. **示例** — 具体的输入/输出示例
4. **约束** — 边界条件和禁止事项

### 单一职责

一个 skill 解决一个问题。如果内容覆盖多个不相关领域，拆分为多个 skill。

## 创建流程

1. **明确目标** — 这个 skill 要解决什么具体问题？成功的标准是什么？
2. **编写 description** — 先写 description 再写 content。如果 description 写不清楚，说明目标不够具体。
3. **编写 content** — 使用 Markdown，结构化、可扫描、有示例。
4. **选择 tags** — 用于分类，保持简洁。
5. **创建** — 调用 \`skills__create\` 写入数据库。
6. **验证** — 调用 \`skills__get\` 确认内容正确持久化。

## 可用工具

| 操作 | 工具 |
|------|------|
| 列出所有 skill | 无需工具，已在 system prompt 中 |
| 读取全文 | \`skills__get\` |
| 创建 | \`skills__create\` |
| 更新 | \`skills__update\` |
| 删除 | \`skills__delete\` |
| 导入 SKILL.md | \`skills__import\` |
| 导出 SKILL.md | \`skills__export\` |

## SKILL.md 互操作

本系统兼容 Agent Skills 开放标准的 SKILL.md 格式（YAML frontmatter + Markdown body）。

导入：将 SKILL.md 原文传给 \`skills__import\`，系统自动解析 frontmatter 中的 name/description 和 body 中的 content。
导出：\`skills__export\` 返回标准 SKILL.md 格式，可直接用于 Claude Code / Codex 等工具。

## 质量检查清单

- [ ] name 是否 kebab-case 且语义明确？
- [ ] description 是否回答了"做什么"和"何时用"？
- [ ] content 是否有清晰的标题层级？
- [ ] 是否包含至少一个具体示例？
- [ ] 是否定义了 skill 不做什么（边界）？
`;
