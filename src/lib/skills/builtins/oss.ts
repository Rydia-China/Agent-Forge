/**
 * Built-in Skill: oss
 *
 * 标准 SKILL.md 格式（YAML frontmatter + Markdown body）以字符串形式内嵌。
 * 由 builtins/index.ts 统一加载解析。
 */
export const raw = `---
name: oss
description: Upload files (images, videos, documents) to Alibaba Cloud OSS for permanent storage. Use when you need to persist generated content or external resources.
tags:
  - core
  - storage
  - upload
requires_mcps:
  - oss
---
# OSS 对象存储服务

## 概述

系统内置 OSS 上传能力，通过阿里云 OSS SDK 实现，提供三个 tool：

- \`oss__upload_from_url\` — 从 URL 拉取并上传到 OSS
- \`oss__upload_base64\` — 上传 base64 编码内容
- \`oss__delete\` — 删除 OSS 对象

所有上传文件存储在 \`public/{folder}/{filename}\` 路径下，返回永久可访问的公网 URL。

## 工具详情

### upload_from_url — 从 URL 上传

从指定 URL 下载文件并上传到 OSS，返回 OSS 永久 URL。最常用场景：持久化 FC 生成的图片/视频。

**参数**：
- \`url\`（必填）— 源文件 URL
- \`folder\`（可选）— OSS 目录名，如 "image"、"video"、"file"，默认 "file"
- \`filename\`（可选）— 目标文件名，不填则自动生成

**示例**：

\\\`\\\`\\\`json
{
  "url": "https://example.com/generated-image.png",
  "folder": "image"
}
\\\`\\\`\\\`

**返回**：
\\\`\\\`\\\`json
{
  "url": "https://mobai-file.oss-cn-shanghai.aliyuncs.com/public/image/1234-abc.png",
  "objectName": "public/image/1234-abc.png"
}
\\\`\\\`\\\`

### upload_base64 — 上传 base64 内容

将 base64 编码的二进制数据直接上传到 OSS。适用于 agent 直接生成的内容。

**参数**：
- \`data\`（必填）— base64 编码的文件内容
- \`filename\`（必填）— 目标文件名（含扩展名，如 "chart.png"）
- \`folder\`（可选）— OSS 目录名，默认 "file"

### delete — 删除对象

**参数**：
- \`objectName\`（必填）— OSS 对象完整路径（如 "public/image/1234-abc.png"）

## 典型工作流

### 生成图片 → 持久化到 OSS

FC 生成的图片 URL 可能有时效性，使用 OSS 上传持久化：

1. 调用 \`video_mgr__generate_image\` 生成图片，获得临时 URL
2. 调用 \`oss__upload_from_url\`，传入临时 URL + folder="image"
3. 使用返回的 OSS URL 作为永久链接

### 批量资源归档

将多个外部资源统一归档到 OSS：

1. 逐个调用 \`oss__upload_from_url\`
2. 收集所有返回的 OSS URL

## 环境配置

需要在 \`.env\` 中配置以下变量（与 video-mgr 项目共用）：

- \`OSS_REGION\` — 地域，如 cn-shanghai
- \`OSS_BUCKET\` — Bucket 名称
- \`OSS_ACCESS_KEY_ID\` — AccessKey ID
- \`OSS_ACCESS_KEY_SECRET\` — AccessKey Secret
- \`OSS_ENDPOINT\`（可选）— 自定义 endpoint，默认 oss-{region}.aliyuncs.com

未配置时 MCP 不可用（catalog 中 available=false），不会崩溃。
`;
