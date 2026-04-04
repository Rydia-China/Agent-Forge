/**
 * Built-in Skill: ep-video-workflow
 *
 * EP级视频制作工作流 — 分镜生成、视频制作等EP范围的操作。
 * 标准 SKILL.md 格式（YAML frontmatter + Markdown body）以字符串形式内嵌。
 */
export const raw = `---
name: ep-video-workflow
description: EP-level video production workflow (storyboard generation, video creation). Use when working on episode-specific content like shots, scenes, and video generation.
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
- **场景渲染** — EP特定的场景画面
- **镜头组合** — 镜头序列的串联和过渡
- **视频合成** — 最终视频输出

这些资源的 \`scopeType\` 必须为 \`"script"\`，属于当前EP。

## 与小说级的区分

- **小说级（novel-resource-mgr）** — 初始化全局共享资源（角色立绘、场景位置），scopeType = "novel"
- **EP级（本 skill）** — 制作当前集的视频内容，scopeType = "script"

EP级工作流可以**引用**小说级资源（作为参考图等），但**不应修改**小说级资源。

## 工作流程

### 1. 初始化EP

上传剧本后，系统会自动解析：
- EP名称、剧本内容
- 人物列表（引用小说级角色）
- 场景列表（可能包含新场景）

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
- **视频延长** — 串联多个镜头（使用 \`extract_video_segment\` + \`multimodal\` 模式）

### 3. 视频序列化

对于连续的镜头序列，使用视频延长技术保持画面连贯：

1. 生成第一个镜头视频
2. 提取最后 2-5 秒作为参考片段
3. 用参考片段 + 下一镜头的prompt生成续写视频
4. 重复步骤2-3

详细流程见 video-mgr skill 的"视频延长/续写流程"部分。

### 4. EP特定场景

如果EP需要新的场景（小说级未包含），应在**EP级**创建：
- \`category\`: "EP场景" 或 "ep_scenes"
- \`scopeType\`: "script"

但如果场景会在多个EP复用，应回到小说级资源管理页面添加到小说级。

## 常见模式

### 批量生成分镜
一次调用可生成多个镜头：
\\\`\\\`\\\`json
{
  "items": [
    { "key": "shot_1_1", "prompt": "...", "category": "分镜", "scopeType": "script", "scopeId": "..." },
    { "key": "shot_1_2", "prompt": "...", "category": "分镜", "scopeType": "script", "scopeId": "..." },
    { "key": "shot_1_3", "prompt": "...", "category": "分镜", "scopeType": "script", "scopeId": "..." }
  ]
}
\\\`\\\`\\\`

### 复用小说级资源
引用角色立绘和场景图：
1. 查看右侧资源面板，找到小说级资源
2. 使用其URL作为 \`referenceImageUrls\`
3. 或通过 Image Registry 查找

### 服装/道具管理
如果EP需要角色的特定服装：
- \`category\`: "服装" 或 "costumes"
- \`scopeType\`: "script"（除非会在多个EP复用，那应该是 "novel"）

## 注意事项

- **检查资源面板** — 右侧面板会同时显示小说级和EP级资源
- **命名规范** — key 使用 \`shot_{场景}_{镜头}\` 格式
- **视频生成耗时** — 每个视频需要 2-4 分钟，合理规划批次
- **版本管理** — 相同 key 重新生成会创建新版本，旧版本保留可回滚

## 可用工具

### video_mgr MCP

- \`generate_image\` — 生成分镜图片
- \`generate_video\` — 生成视频（text-to-video, image-to-video, multimodal）
- \`extract_video_segment\` — 提取视频片段（用于延长）
- \`resolve_key_resource\` — 查询资源URL

详细参数见工具 schema 和 video-mgr skill。

## 当前上下文

系统会自动注入：
- \`novel_id\` — 所属小说ID
- \`script_id\` — 当前EP的数据库ID
- \`script_key\` — EP标识（如"EP01"）
- \`init_result\` — EP初始化结果（人物、场景等）

EP初始化失败时会提示，需要先重新上传或手动初始化。
`;
