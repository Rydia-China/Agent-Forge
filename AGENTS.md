# Agent Forge

## 强约束
以下约束不可违反，任何变更必须继续满足这些条件。

### 类型安全
- **禁止 `any`** — 零容忍，无例外（第三方生成代码除外）
- **禁止盲目 `as` 断言** — 外部输入（API body、MCP args）必须通过 Zod `.parse()` 校验后使用
- Prisma 操作使用生成的类型（`Prisma.SkillCreateInput` 等），禁止 `Record<string, unknown>` 代替
- tsconfig `strict: true` + `noUncheckedIndexedAccess: true`

### 架构约定
- **Service Layer** — 业务逻辑统一在 `src/lib/services/` 下实现
- API routes 和 MCP providers 均调用 service，不允许重复实现 CRUD
- API routes 职责：HTTP 协议转换 + Zod 输入校验 + 调用 service
- MCP providers 职责：Tool 定义 + Zod args 校验 + 调用 service

### 依赖原则
- **始终使用 pnpm** 作为包管理器，禁止 npm / yarn
- 能用成熟第三方库解决的不造轮子（前提：稳定、类型完备、社区活跃）
- Zod 作为唯一输入校验方案（与 MCP SDK 保持一致）
- 不维护自建的辅助脚本，能用 pnpm scripts / 现有 CLI 解决的优先
- Schema 变更优先使用 `npx prisma db push`；涉及删列、改类型等破坏性操作时必须明确警告并等待确认

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

### AI 可观测性
- AI agent 可通过 `curl` 调用本系统 REST API 和 MCP 端点，观测系统运行状态
- `docs/api-playbook.md` 记录接口间的因果关系、调用次序、验证方法——这些信息无法从代码推断
- 任何新增/变更 API 时，同步更新 playbook 中的时序依赖和验证清单

### 兼容性
- Agent 使用 OpenAI chat/completions 格式 (tool-use loop)
- Dynamic MCP 统一使用 JS 编写，运行于 isolated-vm 沙盒
- Skill 的 progressive disclosure: metadata 先行，全文按需加载

## 测试流程
- 测试前必须先阅读 `docs/api-playbook.md`，理解接口间的因果链和时序依赖
- 根据要测试的功能，找到 `docs/useCase/` 下对应的 use case 文档，按其验证步骤逐步执行
- 测试结果与文档描述不一致时，遵循 playbook 中的测试原则：优先假设文档过时，矫正文档而非改代码

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
- `docs/api-playbook.md` — 接口调用次序与验证手册（给 AI agent）

## 端口
- 8001 (env `PORT`)

## 环境变量
- `.env.example` 是环境变量的唯一源，提交到 Git
- 新增 `process.env.XXX` 时，必须同步更新 `.env.example` 和 `.env`（实际值留空或填默认值）

## Git 协作
- 功能完成后提交，删除代码前也先提交，保留完整历史可恢复

## 参照项目
- `/Users/rydia/Project/mob.ai/git/noval.demo.2` — 后端参照
- 本系统功能独立，不依赖上述项目运行
