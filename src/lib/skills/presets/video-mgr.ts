/**
 * Built-in Skill: video-mgr
 *
 * 标准 SKILL.md 格式（YAML frontmatter + Markdown body）以字符串形式内嵌。
 * 由 builtins/index.ts 统一加载解析。
 */
export const raw = `---
name: video-mgr
description: Generate images and videos via FC (Function Compute) multimodal services. Use when asked to create, generate, or produce images or videos.
tags:
  - core
  - multimodal
  - image
  - video
requires_mcps:
  - video_mgr
---
# 多模态生成服务（video-mgr）

## 工具语义（参数结构见 tool schema）

### generate_image — 文生图（带生命周期管理）

每次调用记录 prompt、URL 和版本历史。同一 key 再次调用会创建新版本而非新图片。生成成功后系统自动写入 domain_resources，无需手动 INSERT。

- \`key\` — 语义唯一标识。命名规范：\`char_{name}_portrait\`、\`scene_{n}_bg\`、\`shot_{scene}_{shot}\`、\`costume_{name}_{ep}\`，其他用描述性英文下划线连接
- \`category\` — 自由命名（如 \`角色立绘\`、\`场景\`、\`分镜\`），决定 UI 资源面板分组
- \`scopeType\` — 角色立绘等全局资源用 \`"novel"\`，分镜/服装等集级资源用 \`"script"\`
- \`scopeId\` — 从上下文取对应的 novel_id 或 script_db_id

**重要**：生成前检查 Image Registry，key 已存在且满足需求则无需重复生成。

**示例**：

\\\`\\\`\\\`json
{ "items": [{ "key": "char_alice_portrait", "prompt": "一个穿着蓝色连衣裙的少女站在樱花树下，动漫风格，高清", "category": "角色立绘", "scopeType": "novel", "scopeId": "novel-uuid-here", "title": "Alice" }] }
\\\`\\\`\\\`

### generate_video — 存储视频 prompt（当前不实际生成）

仅持久化运动 prompt 到 domain_resources，用户可在 UI 中未来手动触发生成。\`sourceImageUrl\` 通常传 generate_image 的输出。scopeType/scopeId 规则同上。

### Image Registry

上下文自动注入 \`## Image Registry\`，列出当前 session 所有图片的最新状态。

- 用户可能通过 UI 修改 prompt、重新生成或回滚版本，这些操作会以 \`[系统通知]\` 形式出现在对话中
- 看到 \`[系统通知]\` 时，以 Image Registry 中的最新状态为准

`;
