/**
 * Built-in Skill: style-preset
 *
 * 标准 SKILL.md 格式（YAML frontmatter + Markdown body）以字符串形式内嵌。
 * 由 builtins/index.ts 统一加载解析。
 */
export const raw = `---
name: style-preset
provider: style_preset
description: Manage and use local style presets for image/video generation. Use when you need to discover available styles, inspect style details, or configure which style to apply during generation.
tags:
  - core
  - style
  - video
requires_mcps:
  - style_preset
---
# 风格提示词预设（Style Presets）

## 概述

Style Presets 是本地管理的风格词库，每个 preset 包含：
- **name** — 唯一名称标识
- **prompt** — 纯风格词文本（如 "anime style, flat color, ..."）
- **referenceImageUrl**（可选）— 参考图，生成时自动作为首张参考图传入

## 可用工具

- \`style_preset__list_styles\` — 列出所有 style presets（id, name, prompt, referenceImageUrl）
- \`style_preset__get_style\` — 按 id 或 name 查看单个 preset 详情

## 使用方式

### 在 generate_* 工具中传入 styleId

所有 generate 类工具（\`generate_portrait\`、\`generate_scene\`、\`generate_costume\`、\`generate_video\`）均支持可选参数 \`styleId\`：

\\\`\\\`\\\`json
{
  "novelId": "xxx",
  "characterName": "Luna",
  "styleId": "clxxx..."
}
\\\`\\\`\\\`

传入 styleId 后，工具内部自动：
1. 从 DB 读取 preset 的 prompt，替代 Langfuse 风格词
2. 若 preset 有 referenceImageUrl，自动 prepend 到参考图列表首位

未传 styleId 时，保持原有 Langfuse 风格词获取逻辑（向后兼容）。

### 典型工作流

1. 调用 \`style_preset__list_styles\` 查看可用风格
2. 选定 preset 的 id
3. 在 skill 中写明 "使用 styleId=xxx"，后续所有 generate 调用自动携带
4. 调用 generate_portrait / generate_scene 等工具时传入 styleId

### 在 Skill 中固定风格

为保证风格一致性，推荐在视频制作相关 skill 的内容中明确指定 styleId：

\\\`\\\`\\\`
## 风格配置
本工作流使用风格 preset: styleId = "clxxx..."
所有 generate_portrait / generate_scene / generate_costume / generate_video 调用均须传入此 styleId。
\\\`\\\`\\\`

这样 agent 在执行 skill 时会稳定地将 styleId 传递给每个 generate 工具。

## 约束

- Style presets 由用户在 UI 中管理（Resources 面板上方的 Style 按钮）
- Preset 的 prompt 是纯风格词，不含模板变量
- 参考图由 FC / Seedance 自动处理，无需在 prompt 中描述
`;
