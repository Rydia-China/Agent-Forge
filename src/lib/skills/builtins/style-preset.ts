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
- **name** — 唯一名称标识（主键，所有查询和引用均通过 name）
- **prompt** — 风格词文本（如 "anime style, flat color, ..."），图片和视频生成共用
- **referenceImageUrl**（可选）— 参考图，生成时自动作为首张参考图传入

**核心原则：风格词只存在于 StylePreset DB，代码和 Langfuse 中禁止硬编码风格词。**

## 可用工具

- \`style_preset__list_styles\` — 列出所有 style presets（name, prompt, referenceImageUrl）
- \`style_preset__get_style\` — 按 name 查看单个 preset 详情

## 使用方式

### 在 generate_* 工具中传入 styleName

所有 generate 类工具（\`generate_portrait\`、\`generate_scene\`、\`generate_costume\`、\`generate_video\`）均通过 \`styleName\` 参数接收风格：

\\\`\\\`\\\`json
{
  "novelId": "xxx",
  "characterName": "Luna",
  "styleName": "location_style"
}
\\\`\\\`\\\`

工具内部自动：
1. 通过 name 从 DB 查找 StylePreset，读取 prompt 作为风格词
2. generate_video 时最终 prompt 结构为：[copyright, clipDescription, prompt, referenceInfo]
3. 图片生成和视频生成共用同一个 prompt 风格词
4. 若 preset 有 referenceImageUrl，自动 prepend 到参考图列表首位

### styleName 约定

各 generate 工具对应的 StylePreset：
- **角色立绘（初次创建）** (\`generate_portrait\`) → \`styleName = "portrait-style"\`
- **角色立绘（更新）** (\`update_portrait\`) → \`styleName = "update_portrait_style"\`
- **换装图** (\`generate_costume\`) → \`styleName = "portrait-style"\`
- **场景 single** (\`generate_scene\` mode=single) → \`styleName = "location_style"\`
- **场景 grid** (\`generate_scene\` mode=grid) → \`styleName = "location_grid_style"\`
- **场景 hd** (\`generate_scene\` mode=hd) → \`styleName = "sub_location_style"\`
- **视频** (\`generate_video\`) → \`styleName = "video_style"\`

### 在 Skill 中声明风格

Skill 内容中必须明确声明使用哪个 StylePreset name，例如：

\\\`\\\`\\\`
## 风格配置
- 角色立绘（初次创建）: styleName = "portrait-style"
- 角色立绘（更新）: styleName = "update_portrait_style"
- 换装: styleName = "portrait-style"
- 单场景: styleName = "location_style"
- 宫格图: styleName = "location_grid_style"
- 子场景放大: styleName = "sub_location_style"
- 视频: styleName = "video_style"
所有 generate_* / update_* 调用均须传入对应的 styleName。
\\\`\\\`\\\`

agent 执行 skill 时按声明传递 styleName，不要自行判断风格。

## 约束

- **禁止硬编码风格词** — 代码、Langfuse、对话中均不得出现风格词字面量
- StylePreset 通过 name 查找，不使用 id
- Preset 的 prompt 是纯风格词，图片和视频共用，不含模板变量
- Langfuse 模板是生图/生视频的指令，风格词作为其中一个变量注入
- 参考图由 FC / Seedance 自动处理，无需在 prompt 中描述
`;
