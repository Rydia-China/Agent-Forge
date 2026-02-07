# Agent Forge

## 强约束
以下约束不可违反，任何变更必须继续满足这些条件。

### Skills 标准
- 遵循 **Agent Skills 开放标准** (agentskills.io)
- Skill 格式为 SKILL.md: YAML frontmatter (`name`, `description`) + Markdown body
- DB 字段与标准字段一一对齐，支持 SKILL.md 导入/导出
- 必须兼容 Claude Code / Codex / Cursor 等主流 agent 工具的 skills 体系

### MCP 标准
- 遵循 **Model Context Protocol** 开放标准 (modelcontextprotocol.io)
- 使用 `@modelcontextprotocol/sdk` 官方 TypeScript SDK 实现
- 不自建私有协议，所有 tool/resource 定义符合 MCP spec

### asMCP
- 系统本身对外暴露为标准 MCP Server (Streamable HTTP, `POST /mcp`)
- 第三方 agent 可通过 `{ "url": "http://host:8001/mcp" }` 直接对接
- 暴露内容: 所有内部 tools + skills 作为 resources + agent 对话能力

### 兼容性
- Agent 使用 OpenAI chat/completions 格式 (tool-use loop)
- Dynamic MCP 统一使用 JS 编写，运行于 isolated-vm 沙盒
- Skill 的 progressive disclosure: metadata 先行，全文按需加载

## 开发纪律
- `docs/ROADMAP.md` 是唯一的短期规划文件
- **ROADMAP 中所有条目未全部完成前，不得开发新功能**
- 每完成一个条目，从 ROADMAP 中删除该条目并提交
- 新需求必须先追加到 ROADMAP 末尾，再按顺序执行

## 文档原则
文档只记录代码无法自我表达的结构性信息。
- 代码能表达的不写
- 单文件能推断的不写
- 可从 codebase 直观推断的拓扑、路由等不写
- 会随代码增长而膨胀的具体列表不维护（如路由清单、模型清单）
- 仅记录：跨系统边界、外部依赖约定、不可从代码推断的架构决策
- 若确需维护具体列表，必须有裁剪机制（如只保留 top-level 摘要）

## 索引
- `docs/ROADMAP.md` — 短期目标（唯一规划文件）
- `docs/dataflow.md` — 跨边界数据流（仅记录跨系统边界）

## 端口
- 8001 (env `PORT`)

## Git 协作
- 功能完成后提交，删除代码前也先提交，保留完整历史可恢复

## 参照项目
- `/Users/rydia/Project/mob.ai/git/noval.demo.2` — 后端参照
- 本系统功能独立，不依赖上述项目运行
