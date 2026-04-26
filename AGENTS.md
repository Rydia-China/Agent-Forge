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

### Context Recovery
- 当需要的中间产物（subagent 输出、编译结果等）不在当前上下文中时，**必须先通过 MCP/DB recall 已持久化的数据**
- 禁止在未尝试 recall 的情况下 re-execute 任何已完成的步骤
- 长对话中每个关键产物生成后，必须立即持久化到 DB/文件，不得仅依赖上下文保持

### 专项强化模块（Domain Specialization）
- 系统支持通用能力的 **领域专用裁剪**：将 skills、MCP tools、biz-db、chat、OSS 等通用基础设施组合为面向特定领域的工作台
- 每个专项模块由以下部分组成：
  - **领域 Schema** — 单一 `domain_resources` 表，LLM 通过 `category` 字段自由分类，代码只按 `media_type`（image/video/json）渲染
  - **领域 Skills** — 预绑定的 builtin skills（如 video-mgr、novel-video-workflow）
  - **领域 MCP Tools** — 对应的 static MCP provider（如 video_mgr）
  - **领域 Context Provider** — 为 agent 注入领域上下文（当前 novel、script 等），使对话天然具备领域感知
  - **领域 UI** — 专用布局：左侧=最终交付物（storyboard），中间=chat，右侧=按 category 动态分组的资源素材
- 专项模块不是独立系统，是通用能力的**组合 + 约束**；新增领域时复用同一套 pattern
- 当前实例：`src/app/video/` + `src/lib/video/` — 小说转视频工作流

### 兼容性
- Agent 使用 OpenAI chat/completions 格式 (tool-use loop)
- MCP 统一使用 TypeScript 编写，代码库维护
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

### Git 纪律（零容忍）

#### 提交纪律（强制执行）
1. **原子化提交（Atomic Commits）** — 每个提交只做一件事，功能完整可独立回滚
2. **立即提交（Commit Immediately）** — 完成一个逻辑单元后立即提交，不积累多个变更
3. **删除前先提交** — 删除任何代码前必须先提交当前状态，保留完整历史可恢复
4. **禁止强制操作不留记录** — 任何 revert/reset 操作必须通过 `git revert` 留下记录，禁止 `git reset --hard` 抹除历史（自动保护机制除外）

#### Revert 规范（必须留记录）
- **使用 `git revert`** — 回退错误提交时使用 `git revert <commit>`，生成新的 revert commit
- **禁止 `git reset --hard`** — 除自动保护机制外，人工操作禁止使用 `reset --hard` 抹除提交历史
- **Revert 必须说明原因** — Revert commit message 格式：`revert: <original-message> - <reason>`
- **示例**：`revert: feat: add user auth - breaks existing API contract`

#### 提交信息规范
- **格式**：`<type>: <description>`
- **类型**：`feat`（新功能）、`fix`（修复）、`docs`（文档）、`refactor`（重构）、`test`（测试）、`chore`（构建/工具）
- **描述**：简洁明确，说明做了什么（不是为什么）
- **示例**：`feat: add JWT authentication middleware`、`fix: prevent null pointer in user service`

### Worktree 开发流程（强制）
**主分支（main）禁止直接编写任何代码。所有开发必须在 worktree 中进行。**

#### 强制规则（零容忍）
1. **禁止在主工作区编写代码** — 主工作区只用于：查看代码、运行服务、合并分支
2. **所有代码变更必须在 worktree 中完成** — 包括新功能、bugfix、文档、配置变更
3. **Worktree 不推送到远程** — 每个 worktree 的生命周期仅限单一功能，完成后本地合并并删除
4. **合并后立即清理 worktree** — 避免 worktree 堆积
5. **Worktree 中严格执行原子化提交** — 每完成一个逻辑单元立即提交，不积累变更

#### AI Agent 强制约束（违反将受到严厉惩罚）
**对于 AI Agent（包括但不限于 LLM、自动化脚本）操作本仓库时：**

1. **绝对禁止在 main 分支直接修改任何文件** — 包括代码、文档、配置、任何文本文件
2. **任何文件变更操作前必须先创建 worktree** — 无论变更大小，无论是否"只是文档"
3. **违反此规则将触发自动保护机制** — 60 秒内所有变更被强制回退，工作成果全部丢失
4. **不存在"临时修改"或"快速修复"的例外** — 所有变更必须经过 worktree → commit → merge 流程
5. **AI Agent 必须在每次操作前检查当前分支** — 如果在 main 分支，必须立即停止并创建 worktree

**惩罚机制：**
- 第一次违规：工作成果被自动清除，需重新开始
- 持续违规：表明 AI Agent 未遵循指令，需要人工介入修正 Agent 行为
- 保护机制不可绕过：任何试图禁用保护机制的行为都是严重违规

#### 标准流程
```bash
# 1. 创建 worktree（手动创建分支）
git worktree add -b agent/<task-name> .agent-worktrees/<task-name>

# 2. 在 worktree 中开发（原子化提交）
cd .agent-worktrees/<task-name>
# ... 编写代码（完成一个逻辑单元）...
git add -A && git commit -m "feat: add user model"
# ... 继续开发（完成下一个逻辑单元）...
git add -A && git commit -m "feat: add user service"
# ... 多次原子化提交，每次提交功能完整可独立回滚 ...

# 3. 验证无误后，在主工作区合并
cd /path/to/main
git checkout main
git merge --no-ff agent/<task-name>

# 4. 清理 worktree
git worktree remove .agent-worktrees/<task-name>
git branch -d agent/<task-name>
```

#### 自动保护机制（60秒检测周期）
- **保护守护进程** — `scripts/protection-daemon.sh` 每 60 秒检测一次 main 工作区状态
- **自动回退触发条件**：仅限主分支存在未提交的修改（`git diff-index` / `git ls-files --others --exclude-standard` 检测到 dirty workdir，gitignore 匹配的路径不计入）
- **回退操作**：仅 `git reset --hard HEAD && git clean -fd`（只清工作区，HEAD 不动，.gitignore 匹配的文件会被保留）
- **绝不触变提交历史** — 本地 main 领先 `origin/main` 是合法状态（如刚合并 worktree 分支待 push），daemon 不会也不得对 commit 执行 reset/revert/rebase。因历史原因参见 `scripts/protect-main-branch.sh` 顶部注释
- **审计日志** — 所有回退操作记录在 `.git/main-protection.log`，包含时间戳和回退内容
- **零例外（针对工作区）** — 任何在 main 上直接编辑文件的动作，60 秒内都会被 dirty workdir 清理干净

#### 保护机制启动
```bash
# 开发时自动启动（推荐）
./scripts/dev-full.sh  # 同时启动保护守护进程和开发服务器

# 手动控制守护进程
./scripts/protection-daemon.sh start   # 启动
./scripts/protection-daemon.sh stop    # 停止
./scripts/protection-daemon.sh status  # 检查状态
```

#### 违规操作排查
如果提交消失或被回退：
```bash
# 1. 检查保护日志
tail -f .git/main-protection.log

# 2. 确认当前分支
git branch --show-current  # 必须在 worktree 分支，不能是 main

# 3. 检查守护进程状态
./scripts/protection-daemon.sh status

# 4. 如果在 main 分支，立即切换到 worktree
git worktree add -b agent/<task-name> .agent-worktrees/<task-name>
cd .agent-worktrees/<task-name>
```

**任何代码变更都必须在 worktree 中完成，无例外。**

## 参照项目
- `/Users/rydia/Project/mob.ai/git/noval.demo.2` — 后端参照
- 本系统功能独立，不依赖上述项目运行
