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

### generate_video — 视频生成（Seedance 2.0）

生成视频需要 2-4 分钟。支持多种模式：

- **text_to_video** — 纯文本生成（不传参考素材）
- **first_frame** — 图生视频（传入 \`sourceImageUrls: [url]\`）
- **first_last_frame** — 首尾帧插值（传入 2 张图）
- **multimodal** — 多模态参考（图片/视频/音频）

#### 视频延长/续写流程：

**场景**：视频 A 已生成，需要生成后续视频 B，保持画面连贯。

**步骤**：

1. **裁切参考片段** — 提取视频 A 的最后 2-5 秒作为运动参考：
   \\\`\\\`\\\`js
   extract_video_segment({
     sourceVideoUrl: "video_a_url",
     startSec: duration_a - 5,  // 最后 5 秒
     endSec: null,
     key: "video_a_tail",
     category: "参考片段",
     // scopeType/scopeId...
   })
   // → 返回 { videoUrl: "tail_clip_url" }
   \\\`\\\`\\\`

2. **生成续写视频** — 用 tail_clip_url 作为参考：
   \\\`\\\`\\\`js
   generate_video({
     items: [{
       key: "video_b",
       prompt: "继续奔跑，穿过森林",
       generateType: "multimodal",
       sourceVideoUrls: ["tail_clip_url"],  // 传入裁切的片段
       duration: 5,
       // category/scopeType/scopeId...
     }]
   })
   \\\`\\\`\\\`

**串行 + 分支并行**：如果需要生成镜头序列 shot_1 → shot_2 → shot_3，其中 shot_2a 和 shot_2b 同时依赖 shot_1：
- 先生成 shot_1
- 裁切 shot_1 尾部
- 并行生成 shot_2a 和 shot_2b（都用 shot_1 的尾部作为 refer）
- 继续生成 shot_3a/shot_3b

参数规则同 generate_image。

### extract_video_segment — 按时间范围裁剪视频

从源视频提取指定时间段。支持：
- 任意范围：\`{ startSec: 3, endSec: 5 }\` → 截取第 3-5 秒
- 前 N 秒：\`{ startSec: 0, endSec: 3 }\` → 前 3 秒
- 后 N 秒：\`{ startSec: X, endSec: null }\` → 从第 X 秒截取到结尾（需先计算 duration）

裁剪后的片段自动上传并持久化到 domain_resources。

### Image Registry

上下文自动注入 \`## Image Registry\`，列出当前 session 所有图片的最新状态。

- 用户可能通过 UI 修改 prompt、重新生成或回滚版本，这些操作会以 \`[系统通知]\` 形式出现在对话中
- 看到 \`[系统通知]\` 时，以 Image Registry 中的最新状态为准

`;
