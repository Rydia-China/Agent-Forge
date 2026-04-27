/**
 * Built-in Skill: ep-video-workflow
 *
 * EP级视频制作工作流 — 分镜生成、视频制作等EP范围的操作。
 * 标准 SKILL.md 格式（YAML frontmatter + Markdown body）以字符串形式内嵌。
 */
export const raw = `---
name: ep-video-workflow
description: EP级视频制作工作流，用于分镜生成、镜头图片和视频创建。仅用于剧集级内容，不修改小说级资源
tags:
  - video
  - episode
  - workflow
requires_mcps:
  - video_mgr
---
# EP级视频制作工作流（ep-video-workflow）

## 职责范围

本 skill 专注于**EP级**（单集）视频制作，包括：

- **分镜制作** — 根据剧本生成分镜图片/视频
- **场景渲染** — EP 特定的场景画面
- **镜头组合** — 镜头序列的串联和过渡
- **视频合成** — 最终视频输出

这些资源的 \`scopeType\` 必须为 \`"script"\`，\`scopeId\` 必须使用当前上下文中的 \`script_id\`，属于当前 EP。

## 与小说级的区分

- **小说级（novel-resource-mgr）** — 初始化全局共享资源（角色立绘、场景位置），scopeType = "novel"
- **EP级（本 skill）** — 制作当前集的视频内容，scopeType = "script"

EP级工作流可以**引用**小说级资源（作为参考图等），但**不应修改**小说级资源。需要新增会跨 EP 复用的角色或场景时，应让用户回到小说级资源 agent。

## 工作流程

### 1. 理解当前 EP

系统会自动注入：
- EP 名称、剧本内容相关初始化结果
- 人物列表（可引用小说级角色）
- 场景列表（可引用小说级场景）

### 2. 生成分镜

根据剧本内容，为每个镜头生成图片或视频：

#### 分镜图片
使用 \`generate_image\`：
- \`category\`: "分镜" 或 "storyboard"
- \`scopeType\`: "script"
- \`scopeId\`: 当前 script_id（从上下文获取）
- \`key\`: \`shot_{场景}_{镜头号}\`
- \`referenceImageUrls\`: 可引用小说级的角色立绘、场景图

示例：
\\\`\\\`\\\`json
{
  "items": [{
    "key": "shot_1_1",
    "prompt": "Alice站在学校操场上，微笑着向镜头挥手，阳光明媚",
    "referenceImageUrls": ["<角色Alice立绘URL>", "<学校操场场景URL>"],
    "category": "分镜",
    "scopeType": "script",
    "scopeId": "script-uuid-from-context",
    "title": "镜头1-1"
  }]
}
\\\`\\\`\\\`

#### 分镜视频
使用 \`generate_video\`：
- **图生视频** — 基于分镜图生成运动效果
- **文本视频 prompt** — 先持久化视频 prompt，供 UI 后续触发或审阅

### 3. EP 特定场景

如果 EP 需要新的场景（小说级未包含），应在**EP级**创建：
- \`category\`: "EP场景" 或 "ep_scenes"
- \`scopeType\`: "script"

但如果该场景会在多个 EP 复用，应回到小说级资源 agent 添加到小说级。

## 常见模式

### 批量生成分镜
一次调用可生成多个镜头：
\\\`\\\`\\\`json
{
  "items": [
    { "key": "shot_1_1", "prompt": "...", "category": "分镜", "scopeType": "script", "scopeId": "..." },
    { "key": "shot_1_2", "prompt": "...", "category": "分镜", "scopeType": "script", "scopeId": "..." }
  ]
}
\\\`\\\`\\\`

### 复用小说级资源
引用角色立绘和场景图：
1. 查看右侧资源面板中的小说级资源
2. 使用其 URL 作为 \`referenceImageUrls\`
3. 或通过 \`resolve_key_resource\` 查询当前版本 URL

### 服装/道具管理
如果 EP 需要角色的特定服装：
- \`category\`: "服装" 或 "costumes"
- \`scopeType\`: "script"（除非会在多个 EP 复用，那应该是 "novel"）

## 注意事项

- **检查资源面板** — 右侧面板会同时显示小说级和 EP 级资源
- **命名规范** — key 使用 \`shot_{场景}_{镜头}\` 格式
- **版本管理** — 相同 key 重新生成会创建新版本，旧版本保留可回滚
- **边界** — 不要把分镜、单集服装、单集视频写入 novel scope

## 可用工具

### video_mgr MCP

- \`generate_image\` — 生成分镜图片
- \`generate_video\` — 生成或记录视频资源
- \`resolve_key_resource\` — 查询资源 URL

详细参数见工具 schema 和 video-mgr skill。

## 当前上下文

系统会自动注入：
- \`novel_id\` — 所属小说 ID
- \`script_id\` — 当前 EP 的数据库 ID
- \`script_key\` — EP 标识（如 "EP01"）
- \`init_result\` — EP 初始化结果（人物、场景等）

EP 初始化失败时会提示，需要先重新上传或重新初始化。
`;
