/**
 * Built-in Skill: novel-resource-mgr
 *
 * 小说级资源管理 — 初始化角色立绘、场景图片等小说范围共享资源。
 * 标准 SKILL.md 格式（YAML frontmatter + Markdown body）以字符串形式内嵌。
 */
export const raw = `---
name: novel-resource-mgr
description: Initialize and manage novel-level shared resources such as character portraits and scene images. Use for novel-wide resource setup, character initialization, and scene location management.
tags:
  - video
  - resource
  - novel
requires_mcps:
  - video_mgr
---
# 小说级资源管理（novel-resource-mgr）

## 职责范围

本 skill 专注于**小说级**资源的初始化和管理，包括：

- **角色（characters）** — 人物信息、初始立绘、人物设定
- **场景位置（scene_locations）** — 场景地点、场景图片、环境设定

这些资源的 \`scopeType\` 必须为 \`"novel"\`，\`scopeId\` 必须使用当前上下文中的 \`novel_id\`，并会作为 versioned KeyResource 被所有 EP 共享复用。

## 与 EP 级操作的区分

- **小说级（本 skill）** — 初始化全局资源，scopeType = "novel"
- **EP 级（ep-video-workflow）** — 分镜制作、视频生成，scopeType = "script"

## 工作流程

### 1. 初始化小说资源

当用户要求初始化小说资源时，应从小说内容和上下文中提取：

#### 角色信息
- 解析小说中的角色列表
- 为每个主要角色生成初始立绘
- 使用 \`generate_image\` 时：
  - \`category\`: "角色立绘" 或 "characters"
  - \`scopeType\`: "novel"
  - \`scopeId\`: 当前 novel_id（从上下文获取）
  - \`key\`: \`char_{角色名拼音}_portrait\`
  - \`title\`: 角色名称

示例：
\\\`\\\`\\\`json
{
  "items": [{
    "key": "char_alice_portrait",
    "prompt": "一个18岁的少女，长发飘逸，穿着蓝色连衣裙，站在樱花树下，动漫风格，高清",
    "category": "角色立绘",
    "scopeType": "novel",
    "scopeId": "novel-uuid-from-context",
    "title": "Alice"
  }]
}
\\\`\\\`\\\`

#### 场景位置
- 识别小说中的关键场景地点
- 为每个场景生成背景图片
- 使用 \`generate_image\` 时：
  - \`category\`: "场景" 或 "scene_locations"
  - \`scopeType\`: "novel"
  - \`scopeId\`: 当前 novel_id
  - \`key\`: \`scene_{场景名拼音}_bg\`
  - \`title\`: 场景名称

### 2. 资源管理操作

支持对已有小说级资源的增删改查：

- **查看** — 右侧资源面板按 category 分组显示
- **新增** — 使用 \`generate_image\` 创建新资源
- **修改** — 相同 key 重新生成会创建新版本
- **删除** — 目前通过 UI 或专用资源接口操作

### 3. 与 EP 级的协作

- 小说级资源初始化完成后，EP 级工作流可以直接引用这些资源
- 角色立绘可作为分镜生成的参考图（\`referenceImageUrls\`）
- 场景图可作为背景素材

## 注意事项

- **批量生成** — 可以在一次 \`generate_image\` 调用中传入多个角色/场景，提高效率
- **检查重复** — 生成前查看已有资源统计和 Image Registry，避免重复生成
- **命名规范** — key 使用拼音 + 下划线，保持一致性（如 \`char_alice_portrait\`、\`scene_school_bg\`）
- **资源复用** — 小说级资源会被所有 EP 共享，修改会影响全局

## 可用工具

### video_mgr MCP

- \`generate_image\` — 生成图片并持久化为 versioned KeyResource
- \`resolve_key_resource\` — 查询已有资源的当前版本 URL

详细参数见工具 schema。

## 当前上下文

系统会自动注入：
- \`novel_id\` — 当前小说 ID
- 已有小说级资源统计 — 按 category 分组的资源数量
`;
