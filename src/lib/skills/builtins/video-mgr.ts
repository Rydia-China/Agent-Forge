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

## 概述

系统内置两个多模态生成 tool，通过 FC（阿里云函数计算）后端实现：

- \`video_mgr__generate_image\` — 文生图
- \`video_mgr__generate_video\` — 图生视频

两者共用同一组 FC 环境变量，无需额外端口或外部服务。

## 工具详情

### generate_image — 文生图

从文本 prompt 生成图片，返回 OSS 图片 URL。

**参数**：
- \`prompt\`（必填）— 描述要生成的图片内容
- \`referenceImageUrls\`（可选）— 参考图 URL 数组，用于风格或内容引导

**示例**：

\\\`\\\`\\\`json
{
  "prompt": "一个穿着蓝色连衣裙的少女站在樱花树下，动漫风格，高清",
  "referenceImageUrls": ["https://example.com/style-ref.jpg"]
}
\\\`\\\`\\\`

**返回**：
\\\`\\\`\\\`json
{ "imageUrl": "https://oss-cn-shanghai.aliyuncs.com/xxx/generated.png" }
\\\`\\\`\\\`

### generate_video — 图生视频

将一张静态图片 + 运动描述 prompt 生成短视频，返回 OSS 视频 URL。

**参数**：
- \`imageUrl\`（必填）— 源图片 URL（通常是 generate_image 的输出）
- \`prompt\`（必填）— 描述期望的动画/运动效果

**示例**：

\\\`\\\`\\\`json
{
  "imageUrl": "https://oss-cn-shanghai.aliyuncs.com/xxx/generated.png",
  "prompt": "樱花花瓣缓缓飘落，少女的头发在微风中轻轻飘动"
}
\\\`\\\`\\\`

**返回**：
\\\`\\\`\\\`json
{ "videoUrl": "https://oss-cn-shanghai.aliyuncs.com/xxx/generated.mp4" }
\\\`\\\`\\\`

## 典型工作流

### 文生图 → 图生视频

最常见的流程是先生成图片，再用图片生成视频：

1. 调用 \`video_mgr__generate_image\` 生成图片
2. 从返回结果取 \`imageUrl\`
3. 调用 \`video_mgr__generate_video\`，传入上一步的 \`imageUrl\` + 运动 prompt

### 批量生成

需要生成多张图片时，逐个调用 generate_image。每次调用是独立的 FC 函数执行，耗时约 10-30 秒。

## Prompt 编写建议

### 图片 Prompt

- 明确描述主体、场景、风格、画质
- 中英文均可，推荐使用中文描述场景 + 英文描述风格关键词
- 善用参考图（referenceImageUrls）统一画风

### 视频 Prompt

- 描述运动而非静态画面（"花瓣飘落"而非"有花瓣"）
- 动作幅度不宜过大，适合微动效果（头发飘动、光影变化、水面波纹）
- 视频时长固定，无法指定

## 环境配置

需要在 \`.env\` 中配置以下变量（与 video-mgr 项目共用）：

- \`FC_GENERATE_IMAGE_URL\` — FC 图像生成函数 URL
- \`FC_GENERATE_IMAGE_TOKEN\` — FC 图像生成函数 Token
- \`FC_GENERATE_VIDEO_URL\` — FC 视频生成函数 URL
- \`FC_GENERATE_VIDEO_TOKEN\` — FC 视频生成函数 Token

未配置时调用会返回明确错误提示，不会崩溃。

## 约束

- 不支持纯文生视频（必须先有图片）
- 不支持视频编辑或拼接，每次调用生成独立短视频
- 生成结果为 OSS URL，有效期取决于 OSS bucket 策略
- FC 函数有超时限制，超大图片或复杂 prompt 可能失败
`;
