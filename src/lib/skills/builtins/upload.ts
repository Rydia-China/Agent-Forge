/**
 * Built-in Skill: upload
 *
 * 标准 SKILL.md 格式（YAML frontmatter + Markdown body）以字符串形式内嵌。
 * 由 builtins/index.ts 统一加载解析。
 */
export const raw = `---
name: upload
description: Upload local files (images, videos, documents, novels) to any endpoint — files never pass through LLM context.
tags:
  - core
  - upload
  - file
requires_mcps:
  - upload
---
# 客户端直传文件

## 概述

系统支持用户将本地文件直接上传到任意 HTTP 接口，**文件内容不经过 LLM 上下文**。
这对于大文件（视频、小说、PDF）尤为重要——base64 会撑爆 token 上限。

LLM 的职责是**编排**（指定往哪传、怎么传），前端负责**执行**（文件选择 + 直传）。
上传完成后，LLM 上下文中只保留结果（URL、文件名、大小）。

## 工具

### upload__request_upload — 请求用户上传文件

调用此 tool 后，前端会弹出文件上传对话框。用户选择文件后，浏览器直接将文件发送到你指定的 endpoint。

**参数**：
- \`endpoint\`（必填）— 目标上传 URL
- \`method\`（可选）— HTTP 方法，"POST" 或 "PUT"，默认 "POST"
- \`headers\`（可选）— 额外请求头
- \`fields\`（可选）— POST multipart 时的额外表单字段
- \`fileFieldName\`（可选）— multipart 中 file 字段的名称，默认 "file"
- \`accept\`（可选）— 文件类型过滤，如 "image/*"、".txt,.md"
- \`purpose\`（可选）— 向用户展示的上传说明
- \`maxSizeMB\`（可选）— 最大文件大小限制（MB）
- \`bodyTemplate\`（可选）— JSON body 模板，文件读取为文本后替换占位符。设置此项时以 application/json 发送而非 multipart
- \`timeout\`（可选）— 请求超时秒数，默认 60，大文件应设更高

bodyTemplate 支持的占位符：
- \`{{fileContent}}\` — 文件全文（读取为文本）
- \`{{fileName}}\` — 文件名（不含扩展名）
- \`{{fileNameFull}}\` — 文件名（含扩展名）
- \`{{timestamp}}\` — 当前时间 MM-DD-HH:mm

**返回**：\`{ uploadId, status: "pending" }\`
上传完成后，对话历史中会出现一条用户消息包含上传结果。

**示例 1 — 标准文件上传（multipart）**：

\\\`\\\`\\\`json
{
  "endpoint": "https://api.example.com/upload",
  "method": "POST",
  "accept": "image/*",
  "purpose": "请上传图片"
}
\\\`\\\`\\\`

**示例 2 — JSON body 模板（小说上传）**：

\\\`\\\`\\\`json
{
  "endpoint": "http://example.com/novels",
  "method": "POST",
  "accept": ".txt,.md,.epub",
  "purpose": "请上传你的小说文件",
  "bodyTemplate": {
    "name": "{{fileName}}_{{timestamp}}",
    "content": "{{fileContent}}"
  },
  "timeout": 300
}
\\\`\\\`\\\`

## 典型场景

### 用户上传小说到第三方系统
1. 用户说"我想把我的小说上传到 XXX"
2. 调用 \`upload__request_upload\`，endpoint 填 XXX 的上传接口
3. 用户在弹窗中选择文件 → 浏览器直传
4. 你在历史消息中看到 \`[文件上传成功] url: ...\`

### 用户上传图片到本系统 OSS
1. 调用 \`upload__request_upload\`，endpoint 填 \`/api/oss/upload\`，accept 填 \`image/*\`
2. 用户选择图片 → 上传到 OSS → 你拿到 OSS URL

### 用户上传视频到外部存储
1. 用户提供了外部存储的上传接口和认证信息
2. 调用 \`upload__request_upload\`，填入 endpoint + headers（含认证 token）
3. 浏览器直传 → 你拿到结果

## 与 oss__upload_from_url / oss__upload_base64 的区别

- **upload__request_upload** — 用于用户本地文件，文件不经过 LLM 上下文
- **oss__upload_from_url** — 用于已有 URL 的文件（如 FC 生成的临时图片）
- **oss__upload_base64** — 用于 LLM 生成的小型内容（如 SVG、短文本）

当用户要上传本地文件时，**始终使用 upload__request_upload**，不要让用户粘贴 base64。
`;
