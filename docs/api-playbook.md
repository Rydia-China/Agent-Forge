# API Playbook

给 AI agent 的操作手册。记录接口之间的因果关系和调用次序——这些信息无法从代码推断。

> 验证系统状态时使用 `curl http://localhost:8001/...`

## 多轮对话约定

服务端通过 `session_id` 维护会话状态，对话历史持久化在 DB（`ChatSession` + `ChatMessage`）。

- 首次请求不传 `session_id`，服务端自动创建新 session 并在响应中返回 `session_id`
- 后续请求携带 `session_id` 即可延续上下文，服务端从 DB 加载历史消息
- 进程重启不丢失会话

### 调试日志

请求 body 传 `"logs": true`，服务端会将当前 session 完整消息写入 `temp/chat-{sessionId}.{timestamp}.json`。
`temp/` 已 gitignore，不会提交。

## 启动依赖

MCP 初始化是 **惰性** 的——首次 API 请求触发 `initMcp()`。
初始化顺序：注册 static providers (`skills`, `mcp_manager`) → 从 DB 加载所有 `enabled` 的 dynamic MCP → sandbox 执行 → 注册到 registry。

因此：刚启动后第一次请求会较慢（冷启动）。

## 时序依赖（因果链）

### Skill → Agent
1. `POST /api/skills` 创建 skill
2. 下一次 `POST /api/chat` 时，`buildSystemPrompt()` 重新查 DB，新 skill 出现在 system prompt 的 Available Skills 索引中
3. Agent 通过 `skills__get` tool 按需读取全文（progressive disclosure）

**因果**：skill 不存在 → agent 不知道它 → 不会使用。

### Dynamic MCP → Agent
1. `POST /api/mcps` 创建 MCP server（`enabled: true`）
2. service 立即执行：DB 写入 → sandbox 加载 JS 代码 → `registry.replace()` 注册 provider
3. 下一次 agent tool-use loop 时，`registry.listAllTools()` 包含新 tools
4. Agent 可以调用这些 tools

**因果**：dynamic MCP 必须 create 且 sandbox load 成功 → tools 才在 agent 可用。`loadError` 非空说明沙盒加载失败，tools 不可用。

### Agent Chat 完整链路
`POST /api/chat` → `runAgent()`:
1. `initMcp()`（首次）
2. `getOrCreateSession(session_id)` — 从 DB 加载/创建 session 及历史消息
3. `buildSystemPrompt()` — 查 DB 注入 skill 索引
4. `registry.listAllTools()` — 收集所有 provider 的 tools
5. LLM 调用（OpenAI format，历史消息 + 当前 user message）
6. 若 LLM 返回 `tool_calls` → `registry.callTool()` 执行 → 结果追加到 messages → 回到步骤 5
7. 若 LLM 返回纯文本 → `pushMessages()` 持久化本轮所有新消息到 DB → 返回最终 reply
8. 若请求传了 `logs=true` → 写 `temp/chat-{sessionId}.{timestamp}.json`

### Agent Chat Streaming
`POST /api/chat/stream` 使用同一 `runAgent()` 逻辑，但以 SSE 形式增量返回：
- `event: session` → `{ session_id }`
- `event: delta` → `{ text }`（assistant 增量文本）
- `event: tool` → `{ summary }`（工具/skill 摘要）
- `event: done` → `{ session_id, reply }`
- `event: error` → `{ error }`

## 双入口等价性

REST API (`/api/*`) 和 MCP tools（agent 内部 / `/mcp` 外部）**共享同一 service layer**。
通过任一入口的变更，对另一入口**立即可见**。

示例：通过 `curl POST /api/skills` 创建的 skill，agent 下一轮 chat 即可使用。

## Use Cases

Chat 是用户核心入口，验证 chat 即验证 MCP 注册、skill 加载、tool dispatch 全链路。
具体验证步骤见 `docs/useCase/`：

- `llm-chat-create-skill.md` — 通过 chat 创建 skill，验证全链路（LLM 连通 → tool 调用 → DB 持久化 → system prompt 注入）
- `llm-chat-create-mcp.md` — 通过 chat 创建 dynamic MCP，验证全链路（skill 指导 → 沙箱代码编写 → sandbox load → tool 注册 → 端到端调用）
- `chat-with-title.md` — 发起会话 + 并行生成 title，验证 title 生成、持久化、列表可见
- `session-crud.md` — Session 完整生命周期（创建、列出、查看、改名、删除）+ 用户隔离验证

## Tool 命名规则

Agent 内部的 tool name 格式为 `{provider}__{tool}`。具体有哪些 tool 以运行时 `registry.listAllTools()` 为准，不在文档中维护列表。

## 测试原则

- **偏差优先矫正文档** — 当基于文档的测试结果与代码实际行为不一致时，优先假设文档未及时更新，矫正文档使其与代码行为对齐，而非修改代码适配文档。
- **前后端契约审查** — 如前端已实现对应功能，测试时应同时验证前端调用与后端 API 的请求/响应契约是否匹配（字段名、类型、必填/可选）。
- **保留完整报文** — 测试时 curl 命令必须使用 `-v` 并将完整请求/响应（含 headers 和 body）存入 `temp/`，文件命名 `{功能}.{序号}.txt`（如 `skill-create.1.txt`）。便于事后回溯和对比。`temp/` 已 gitignore，不会提交。
