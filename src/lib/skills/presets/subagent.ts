/**
 * Built-in Skill: subagent
 *
 * 标准 SKILL.md 格式（YAML frontmatter + Markdown body）以字符串形式内嵌。
 * 由 builtins/index.ts 统一加载解析。
 */
export const raw = `---
name: subagent
description: Delegate prompt-driven tasks to smaller models via subagent. Use when you need to execute Langfuse prompts or any task that should not run on the main controller model.
tags:
  - core
  - subagent
  - delegation
requires_mcps:
  - subagent
---
# Subagent 委托执行

## 核心原则

**所有从 Langfuse 获取的 prompt 必须通过 subagent 执行，禁止在主控上下文中混合使用。**

原因：
- 主控模型（如 Claude Opus）负责编排和决策，不应处理具体的 prompt 驱动任务
- 混合执行会导致 prompt 的输出被主控的对话上下文污染，结果不可控
- Subagent 调用是独立的、无状态的，保证 prompt 的输入输出纯净

## 可用工具

- \`subagent__run_text\` — 将 prompt 发送给指定模型执行，返回文本结果。支持可选的 JSON Schema 校验 + 自动重试。

### 参数

- \`prompt\`（必填）— 要执行的 prompt（通常来自 \`langfuse__compile_prompts\` 的输出）
- \`model\`（必填）— 模型名称，**没有默认值**，必须由调用方明确指定
- \`imageUrls\`（可选）— 图片 URL 数组，用于多模态任务（如看图生成描述）
- \`outputSchema\`（可选）— JSON Schema 对象。传入后 subagent 会自动校验输出：
  - 自动剥离 markdown 代码围栏（\\\`\\\`\\\`json）
  - 解析 JSON 并用 schema 校验
  - 校验失败时自动带错误上下文重试（最多 maxRetries 次）
  - 校验通过时返回结果中 \`validated=true\`，数据保证符合 schema
- \`maxRetries\`（可选，默认 2，最大 5）— 含首次在内的最大尝试次数

## 模型选择

模型名称由具体的业务 skill 决定，不由 subagent 自行选择。常见模型：

- \`google/gemini-3.1-pro-preview\` — 文本生成、JSON 解析、提示词生成
- \`z-ai/glm-5\` — 长文本分析、章节处理
- \`anthropic/claude-sonnet-4.6\` — 高质量文本生成、复杂推理
- \`anthropic/claude-opus-4.6\` — 最强推理、高难度任务

## 典型工作流

### Langfuse prompt → Subagent

最常见的模式：

1. 调用 \`langfuse__compile_prompts\` 编译 prompt
2. 调用 \`subagent__run_text\` 执行，指定合适的 model
3. 解析返回结果

示例：

\\\`\\\`\\\`
# Step 1: 编译 prompt
langfuse__compile_prompts({
  items: [{
    name: "common__gen_scenery_shot__prompt",
    variables: { style: "日漫风格", scene_description: "校园黄昏" }
  }]
})
→ [{ status: "ok", name: "...", compiledPrompt: "日漫风格，请根据以下剧情生成场景描述：校园黄昏" }]

# Step 2: 执行
subagent__run_text({
  prompt: "日漫风格，请根据以下剧情生成场景描述：校园黄昏",
  model: "google/gemini-3.1-pro-preview"
})
→ "夕阳西下的校园走廊，橙红色的光线透过窗户..."
\\\`\\\`\\\`

### 带 Schema 校验的 JSON 生成（推荐）

当 subagent 需要输出结构化 JSON 时，传入 outputSchema 可保证结果符合预期格式：

\\\`\\\`\\\`
subagent__run_text({
  tasks: [{
    prompt: compiledPrompt,
    model: "google/gemini-3.1-pro-preview",
    outputSchema: {
      type: "object",
      properties: {
        shots: {
          type: "array",
          items: {
            type: "object",
            properties: {
              shot_id: { type: "string" },
              type: { type: "string", enum: ["public", "branch_1", "branch_2", "branch_3"] },
              scene_desc: { type: "string", minLength: 1 }
            },
            required: ["shot_id", "type", "scene_desc"]
          },
          minItems: 1
        }
      },
      required: ["shots"]
    },
    maxRetries: 3
  }]
})
→ { status: "ok", result: "{...}", validated: true, attempts: 1 }
\\\`\\\`\\\`

校验失败时平台层自动重试，对主控透明。重试 prompt 会追加具体的校验错误信息，确保定向修正而非盲目重试。

### 多模态任务

需要 subagent 分析图片时，传入 imageUrls：

\\\`\\\`\\\`
subagent__run_text({
  tasks: [{
    prompt: "描述这张图片中人物的动作和表情",
    model: "google/gemini-3.1-pro-preview",
    imageUrls: ["https://oss.example.com/scene.png"]
  }]
})
\\\`\\\`\\\`

## 什么任务应该委托给 subagent

- 从 Langfuse prompt 驱动的所有生成任务
- JSON 格式化/解析（如 markdown → JSON）
- 提示词生成（如场景描述 → 图片 prompt）
- 图片内容分析（多模态）
- 批量文本处理

## 什么任务不应该委托

- 与用户的对话交互（主控负责）
- 工具调用决策（主控负责）
- 需要访问对话历史的任务（subagent 无状态）

## 约束

- Subagent 调用是无状态的，每次调用独立，无对话历史
- 不提供默认模型，必须显式指定
- 复用主控的 LLM 代理（LLM_API_KEY / LLM_BASE_URL），只是模型不同
- 未传 outputSchema 时返回原始文本；传了 schema 时返回经过校验的 JSON 字符串
- **凡是需要 subagent 输出结构化 JSON 的场景，必须传 outputSchema**
`;
