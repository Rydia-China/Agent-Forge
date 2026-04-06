/**
 * Built-in Skill: subagent
 *
 * 标准 SKILL.md 格式（YAML frontmatter + Markdown body）以字符串形式内嵌。
 * 由 builtins/index.ts 统一加载解析。
 */
export const raw = `---
name: prompt-delegator
provider: subagent
description: Delegate prompt-driven tasks and multi-step operations to subagents. Use when executing compiled prompts, generating structured JSON, running tool-loop operations, or any task that should not run in the main controller context.
tags:
  - core
  - subagent
  - delegation
requires_mcps:
  - subagent
---
# SubAgent 委托执行

## 核心原则

**所有从 Langfuse 获取的 prompt 必须通过 subagent 执行，禁止在主控上下文中混合使用。**
**多步业务操作应委托给 tool-loop 模式的 subagent，而非主控直接调用工具。**

## 统一工具

- \`subagent__run\` — 统一执行入口。模式由 \`mcpScope\` 决定：
  - **省略 mcpScope** → 单次 LLM 调用（single-shot），用于 prompt 执行、JSON 生成、多模态分析
  - **指定 mcpScope** → 多轮 tool-use 循环（tool-loop），subagent 自主调用工具完成任务
- \`subagent__continue\` — 向已有 subagent 追加反馈/指令（通过 \`agentId\`），subagent 保留完整对话历史继续执行
- \`subagent__get_trace\` — 获取 subagent 完整执行 trace（消息历史、每步 tool call、system prompt），用于调试

### 参数

- \`instruction\`（必填）— prompt 或指令
- \`mcpScope\`（可选）— 为空=单次调用，非空=tool-loop 模式
- \`model\`（可选）— 模型名称，默认 \`anthropic/claude-sonnet-4.6\`
- \`imageUrls\`（可选）— 图片 URL 数组，用于多模态任务
- \`outputSchema\`（可选）— JSON Schema 校验 + 自动重试
- \`maxRetries\`（可选，默认 2，最大 5）— 含首次在内的最大尝试次数
- \`includeTrace\`（可选，默认 false）— 在响应中包含完整 trace，调试时开启
- \`skills\`（可选）— 注入 skill 内容作为参考资料（tool-loop 模式）
- \`context\`（可选）— 注入额外上下文到 system prompt（tool-loop 模式）

## 典型工作流

### Langfuse prompt → Subagent（single-shot）

\\\`\\\`\\\`
# Step 1: 查看模板变量名
langfuse__get_prompts({ names: ["common__gen_scenery_shot__prompt"] })

# Step 2: 编译
langfuse__compile_prompts({ items: [{ name: "...", variables: { nodeContent: "..." } }] })

# Step 3: 执行
subagent__run({ tasks: [{ instruction: compiledPrompt, model: "google/gemini-3.1-pro-preview" }] })
\\\`\\\`\\\`

### 带 Schema 校验的 JSON 生成

\\\`\\\`\\\`
subagent__run({ tasks: [{
  instruction: compiledPrompt,
  model: "google/gemini-3.1-pro-preview",
  outputSchema: { type: "object", properties: { shots: { type: "array", ... } }, required: ["shots"] },
  maxRetries: 3
}] })
→ { status: "ok", result: "{...}", validated: true, agentId: "sa_1_..." }
\\\`\\\`\\\`

### Tool-loop 模式（替代原 executor）

\\\`\\\`\\\`
subagent__run({ tasks: [{
  instruction: "查询所有角色并为每个角色生成肖像图",
  mcpScope: ["biz_db", "video_workflow"],
  skills: ["novel-video-workflow"]
}] })
\\\`\\\`\\\`

### 多轮对话（纠错/补充信息）

\\\`\\\`\\\`
# 首次执行
result = subagent__run({ tasks: [{ instruction: "...", mcpScope: [...] }] })
# 结果不理想 → 追加反馈
subagent__continue({ agentId: result.agentId, feedback: "上次漏掉了 X 角色，请补充" })
\\\`\\\`\\\`

### 调试失败的 subagent

\\\`\\\`\\\`
# 执行失败
result = subagent__run({ tasks: [{ instruction: "...", mcpScope: [...] }] })
# 查看完整 trace
subagent__get_trace({ agentId: result.agentId })
→ { messages: [...], toolCalls: [...], systemPrompt: "...", model: "..." }
\\\`\\\`\\\`

## 约束

- Single-shot 模式下每次调用独立；tool-loop 和 continue 模式下保留对话历史
- 默认模型 \`anthropic/claude-sonnet-4.6\`，skill 可显式覆盖
- 未传 outputSchema 时返回原始文本；传了 schema 时返回经过校验的 JSON 字符串
- **凡是需要 subagent 输出结构化 JSON 的场景，必须传 outputSchema**
- **禁止硬编码风格词** — 风格词由运营在 Langfuse 维护
- **禁止猜测变量名** — 必须先 get_prompts 查看实际模板
`;
