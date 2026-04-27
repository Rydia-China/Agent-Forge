# 视频生成管线使用指南

## 概述

本系统实现了完整的 EP 级视频生成管线，包括：

1. **视频镜头规划** — 从剧本生成所有镜头的提示词
2. **Reviewer 审查** — 使用独立 subagent 按 32 项标准审查
3. **迭代改进** — 主模型根据反馈改进提示词，直到通过审查
4. **批量生成** — 调用即梦 API 生成所有视频，支持连续镜头参照

## 核心组件

### 1. Skills 系统

系统使用以下 skills 指导视频生成：

- `video-workflow` — 完整工作流 SOP
- `video-director-playbook` — Seedance 导演原则
- `video-skill-reviewer` — 32 项质量检测标准
- `video-seedance-lessons` — 实测经验教训
- `video-shot-id-policy` — 命名与素材引用规则
- `video-character-dna` — 角色 DNA 锁定规则

**导入 Skills：**

```bash
cd .agent-worktrees/video-generation-pipeline
npx tsx scripts/import-video-skills.ts
```

### 2. MCP Tools

#### `plan_video_shots`

生成 EP 级别的所有视频镜头计划。

**输入：**
```json
{
  "scriptId": "clxxx...",
  "prevEpisodeId": "clyyy...",  // 可选
  "nextEpisodeId": "clzzz..."   // 可选
}
```

**输出：**
```json
{
  "scriptId": "clxxx...",
  "episodeKey": "ep_1",
  "shots": [
    {
      "shotId": "shot_1",
      "duration": 12,
      "mode": "首尾帧双锚 + 三层 reference",
      "scene": "银月领地豪宅议事厅",
      "shotFunction": "Sylvia 在全体长老面前宣读拒绝誓词",
      "prevShotRecap": "Sylvia 在主卧坐了整夜，已做好决定",
      "nextShotSetup": "Sylvia 双膝触地但拒绝收回誓词",
      "emotionArc": "压抑的决心 → 公开的宣言 → Alpha 命令下的抵抗",
      "assets": {
        "images": [
          "scene_council_hall.png",
          "shot_0_ref.jpg",
          "Sylvia人物立绘.png"
        ],
        "videos": []
      },
      "shotPrompt": "完整的视频生成提示词...",
      "definition": "@图1 是 [场景议事厅空镜]，@图2 是 [上一镜末帧]，@图3 是 [Sylvia立绘]",
      "title": "Sylvia 宣读拒绝誓词"
    }
  ],
  "totalShots": 15
}
```

#### `review_video_shots`

使用 reviewer subagent 审查视频镜头提示词。

**输入：**
```json
{
  "scriptId": "clxxx...",
  "shots": [/* plan_video_shots 的输出 */]
}
```

**输出：**
```json
{
  "passed": false,
  "issues": [
    {
      "shotId": "shot_1",
      "category": "W2",
      "description": "缺少 shot_function 字段",
      "severity": "error"
    },
    {
      "shotId": "shot_3",
      "category": "E-9",
      "description": "未明确三重静止收尾",
      "severity": "warning"
    }
  ],
  "suggestions": [
    "所有镜头应补充情绪定位三行",
    "确保每个镜头末尾 2 秒静止"
  ]
}
```

#### `generate_video_shots`

完整的一站式管线：规划 → 审查 → 迭代 → 生成。

**输入：**
```json
{
  "scriptId": "clxxx...",
  "prevEpisodeId": "clyyy...",      // 可选
  "nextEpisodeId": "clzzz...",      // 可选
  "maxReviewIterations": 3          // 默认 3
}
```

**输出：**
```json
{
  "scriptId": "clxxx...",
  "episodeKey": "ep_1",
  "shots": [
    {
      "shotId": "shot_1",
      "status": "completed",
      "videoUrl": "https://oss.../video_shot_1.mp4",
      "prompt": "完整提示词...",
      "reviewIterations": 2
    }
  ],
  "totalIterations": 2
}
```

## 使用流程

### 方式 1：分步执行（推荐用于调试）

```typescript
// 1. 规划镜头
const plan = await planVideoShots({
  scriptId: "clxxx...",
  prevEpisodeId: "clyyy...",
  nextEpisodeId: "clzzz..."
});

// 2. 审查镜头
let shots = plan.shots;
let iteration = 0;
const maxIterations = 3;

while (iteration < maxIterations) {
  const review = await reviewVideoShots({
    scriptId: "clxxx...",
    shots
  });

  if (review.passed) {
    console.log("All shots passed review!");
    break;
  }

  console.log(`Found ${review.issues.length} issues, refining...`);
  
  // 3. 根据反馈改进（需要主 agent 处理）
  shots = await refineShots(shots, review);
  iteration++;
}

// 4. 批量生成视频
for (const shot of shots) {
  const result = await executeVideoShot({
    scriptId: "clxxx...",
    key: shot.shotId,
    shotPrompt: shot.shotPrompt,
    definition: shot.definition,
    duration: shot.duration,
    title: shot.title
  });
  console.log(`Generated: ${result.videoUrl}`);
}
```

### 方式 2：一站式执行（推荐用于生产）

```typescript
const result = await generateVideoShots({
  scriptId: "clxxx...",
  prevEpisodeId: "clyyy...",
  nextEpisodeId: "clzzz...",
  maxReviewIterations: 3
});

console.log(`Generated ${result.shots.length} videos in ${result.totalIterations} iterations`);

result.shots.forEach(shot => {
  if (shot.status === "completed") {
    console.log(`✅ ${shot.shotId}: ${shot.videoUrl}`);
  } else {
    console.log(`❌ ${shot.shotId}: failed`);
  }
});
```

## 关键特性

### 1. 前后 EP 上下文

系统支持输入前后 EP 的剧本作为上下文，确保：
- 情绪连贯性
- 角色状态承接
- 剧情铺垫

### 2. Reviewer Subagent

独立的 reviewer agent 按照 `video-skill-reviewer` 的 32 项标准检查：
- WORKFLOW.md（8 项）
- SEEDANCE_LESSONS.md（9 项）
- DIRECTOR_PLAYBOOK.md（6 项）
- SHOT_ID_POLICY.md（5 项）
- CHARACTER_DNA.md（4 项）

### 3. 迭代改进循环

主模型根据 reviewer 反馈自动改进提示词，直到：
- 所有 error 级别问题修复
- 大部分 warning 级别问题改进
- 达到最大迭代次数

### 4. 连续镜头参照

系统自动处理连续镜头的视觉连贯性：
- 上个视频的末尾 5 秒作为下个视频的参照
- 自动调用 `extract_tail` 裁剪
- 支持 `@视频1` 引用语法

### 5. 图片 URL 压缩

系统自动处理图片参照：
- 从 `definition` 解析 `@图N` 引用
- 自动查找对应的 KeyResource
- 优先使用换装图，其次立绘，最后场景图

## 技术架构

```
┌─────────────────────────────────────────────────────────────┐
│                     MCP Tools Layer                          │
│  plan_video_shots | review_video_shots | generate_video_shots│
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              Video Shot Planning Service                     │
│  - planVideoShots()                                          │
│  - reviewVideoShots()                                        │
│  - generateVideoShots()                                      │
└─────────────────────────────────────────────────────────────┘
                              │
                ┌─────────────┼─────────────┐
                ▼             ▼             ▼
┌──────────────────┐ ┌──────────────┐ ┌──────────────────┐
│  Subagent Service│ │ Skill Service│ │ Asset Generation │
│  - submitSubAgent│ │ - getSkill() │ │ - executeVideoShot│
│  - subscribeEvents│ │              │ │ - generateImage  │
└──────────────────┘ └──────────────┘ └──────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      Skills (OSS)                            │
│  video-workflow | video-director-playbook |                 │
│  video-skill-reviewer | video-seedance-lessons              │
└─────────────────────────────────────────────────────────────┘
```

## 故障排查

### Skills 未找到

```
Error: Required video skills not found. Run import-video-skills.ts first.
```

**解决方案：**
```bash
npx tsx scripts/import-video-skills.ts
```

### Subagent 超时

如果 subagent 执行时间过长，检查：
- 剧本是否过于复杂（建议单 EP 不超过 20 个镜头）
- 模型是否可用（claude-opus-4）
- 网络连接是否稳定

### 审查不通过

如果多次迭代后仍有 error：
- 检查 temp 目录中的 skills 是否为最新版本
- 手动查看 reviewer 反馈，确认问题类型
- 考虑调整 `maxReviewIterations` 参数

### 视频生成失败

如果 `execute_video_shot` 失败：
- 检查 FC API 配置（`FC_API_KEY`, `FC_API_BASE_URL`）
- 确认即梦 API 配额充足
- 检查参照图片 URL 是否可访问

## 性能优化

### 并行生成

系统默认并行生成所有视频。如需控制并发数：

```typescript
// 自定义并发控制
const concurrency = 3;
const results = [];

for (let i = 0; i < shots.length; i += concurrency) {
  const batch = shots.slice(i, i + concurrency);
  const batchResults = await Promise.all(
    batch.map(shot => executeVideoShot({...}))
  );
  results.push(...batchResults);
}
```

### 缓存优化

系统自动缓存：
- Skills 内容（从 OSS 读取后缓存）
- KeyResource 查询结果
- Subagent 输出（持久化到 DB）

## 下一步

- [ ] 支持自定义 reviewer 标准
- [ ] 添加视频质量评分
- [ ] 支持多模型对比生成
- [ ] 实现视频后处理（拼接、转场）
