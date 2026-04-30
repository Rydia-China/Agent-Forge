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

## 外部分发 API

外部分发 key 只用于以下三个接口，不影响 `/api/chat`、`/api/subagents`、`/mcp` 或内部 agent workflow。

配置固定 key：

```bash
EXTERNAL_VIDEO_API_KEYS=customer-a:secret-a,customer-b:secret-b
EXTERNAL_VIDEO_API_KEYS='[{"name":"customer-a","key":"secret-a"},{"name":"customer-b","key":"secret-b"}]'
```

调用时使用任一 header：

```bash
Authorization: Bearer <key>
# 或
x-video-api-key: <key>
```

Seedance 视频生成：

```bash
curl -X POST http://localhost:8001/api/external/video/generate \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <key>' \
  -d '{"prompt":"a cinematic shot of a city at sunset","duration":5}'
```

HappyHorse 视频生成：

```bash
curl -X POST http://localhost:8001/api/external/video/happyhorse \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <key>' \
  -d '{"prompt":"animate this reference image","media":[{"type":"reference_image","url":"https://example.com/image.png"}],"duration":5}'
```

独立 OSS 上传：

```bash
curl -X POST http://localhost:8001/api/external/video/oss/upload \
  -H 'Authorization: Bearer <key>' \
  -F 'file=@/path/to/file.mp4' \
  -F 'folder=video' \
  -F 'prefix=clip'
```

三个接口成功/失败都会按 `apiKeyName + product` 写入 `ApiUsageCounter`，用于后续追索：

```sql
SELECT "apiKeyName", product, "totalCount", "successCount", "failureCount", "lastError", "lastUsedAt"
FROM "ApiUsageCounter"
ORDER BY "lastUsedAt" DESC;
```

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

### Agent Chat Streaming (deprecated)
`POST /api/chat/stream` 仍可用，但前端已迁移到 SubAgent 架构。

### SubAgent 后端驱动架构
SubAgent 解耦了任务执行与前端连接。agent loop 在后端独立运行，客户端通过 SSE 观察。

**提交任务**：
```
curl -X POST http://localhost:8001/api/subagents \
  -H 'Content-Type: application/json' \
  -d '{"message": "hello", "session_id": "optional"}'
# → { "subagent_id": "...", "session_id": "..." }
```
返回后任务已在后端开始执行。

**观察事件流**：
```
curl -N http://localhost:8001/api/subagents/{subagent_id}/events
```
SSE 事件类型：
- `event: session` → `{ session_id }`
- `event: delta` → `{ text }`（assistant 增量文本）
- `event: tool` → `{ summary }`（工具/skill 摘要）
- `event: upload_request` → 上传请求
- `event: key_resource` → 关键资源
- `event: done` → `{ session_id, reply }`
- `event: interrupted` → `{ session_id, output, error, recoverable: true, partial_saved: true, code? }`
- `event: error` → `{ error }`（取消或不可恢复失败）

每个事件带有单调递增 `id:` 字段。断线重连时，服务端通过 `Last-Event-ID` header 从 DB 重放遗漏事件，确保不丢失。

LLM streaming 的瞬时网络错误（如 `ETIMEDOUT`、连接重置、undici `terminated`）不会把任务标记为 `failed`。服务端会先持久化本轮 user message 和已收到的 assistant partial reply，随后将 SubAgent 标记为 `interrupted` 并发送 `interrupted` 事件。该状态表示上下文已保存，用户可以继续发送下一条消息；系统不会自动重跑整轮 agent，避免重复工具调用或外部副作用。

**查询任务状态**：
```
curl http://localhost:8001/api/subagents/{subagent_id}
# → { "id", "sessionId", "status", "output", "error", ... }
# status: pending | running | completed | failed | interrupted | cancelled | max_iterations
```

**取消任务**：
```
curl -X POST http://localhost:8001/api/subagents/{subagent_id}/cancel
```

**重连流程**：
1. `GET /api/sessions/{sid}` → 响应包含 `activeSubAgent: { id, status }` （若有活跃任务）
2. 前端加载 session 时，发现 activeSubAgent → 自动连接 `GET /api/subagents/{subagentId}/events`
3. EventSource 断线时浏览器自动重连，携带 `Last-Event-ID`
4. 若任务已进入 `interrupted`，它不再算活跃任务；前端重新加载 session messages 即可看到已保存的 partial context，用户可继续对话

**因果**：SubAgent 状态和事件持久化到 DB，客户端断开不影响执行，重连后从断点继续。

### SubAgent MCP Provider（2026-04-26 恢复）
`subagent` 是给主 agent 和外部 `/mcp` 调用方使用的 MCP provider，和 `/api/subagents` 后端驱动架构并存，不替代 REST/SSE 任务入口。

时序：
1. `initMcp()` 注册 static provider 后，`registry.listAllTools()` 暴露 `subagent__run`、`subagent__run_async`、`subagent__get_result`、`subagent__get_trace`、`subagent__continue`
2. `subagent__run` 接收 `tasks[]`；每个 task 不传 `mcpScope` 时是 single-shot LLM 调用，传非空 `mcpScope` 时进入 tool-use loop，只能调用指定 provider 的 tools
3. 同步执行完成后返回 `agentId`；该 ID 是进程内 active registry 状态，可继续调用 `subagent__continue` 或 `subagent__get_trace`
4. `subagent__run_async` 或带 `timeout` 的 `subagent__run` 会创建 `SubAgent` DB 记录作为 `taskId`，后台执行完成后把 output/error/trace 写回该记录
5. `subagent__get_result`/`subagent__get_trace` 用 `taskId` 查询 DB 持久化结果；`subagent__continue` 只能用仍在当前进程内存中的 `agentId`

调度兼容性：历史 `schedule` tool 已恢复 tool 面，但当前代码库没有原 scheduler service；只支持进程内一次性 `runAt`，`cron` 会返回明确的 unsupported 结果。

验证重点：`registry.listAllTools()` 或 `/mcp` 的 `tools/list` 必须能看到 `subagent__run`；带 `mcpScope` 的任务必须只看到对应 provider tools；async 返回的 `taskId` 能通过 `subagent__get_result` 查询状态。

### Video 本地剧本导入（2026-04-26 恢复）
`/video` 不应依赖远程 novel service 获取小说列表。业务流来自本地 `feat/hierarchical-agent` 的 `/video` 业务提交，迁移时只恢复上传、落库、读取逻辑，不同步 agent/subagent/runtime 优化。

时序：
1. 前端读取用户上传的 JSON 剧本文件
2. `POST /api/video/novels` 校验 `{ name, script }`
3. service 写入 `novels`，再批量写入 `novel_scripts`
4. service 按 JSON 内容初始化 versioned `KeyResource` 占位；带 2 个及以上真实子地点的父地点只创建 `scene_<父地点名>_grid`，不创建同名父地点单图 `scene_<父地点名>`
5. `GET /api/video/novels` 从本地 biz-db 返回小说列表
6. `GET /api/video/novels/{novelId}/episodes` 从本地 `novel_scripts` 返回 episode 列表
7. episode 资源读取合并 novel scope 与 script scope 的 `KeyResource`

验证重点：`GET /api/video/novels` 不依赖远程小说服务配置；上传后刷新列表能看到新 novel，进入 novel 后能看到从本地脚本表生成的 episode。

### Video 双 agent 个性化入口（2026-04-26 恢复）
`/video/{novelId}` 是领域专用工作台，使用两个不同 agent 入口，而不是修改全局 agent runtime。

小说级资源 agent：
1. 前端选择左侧“小说资源”
2. 会话 user scope 为 `video:{novelId}`
3. `POST /api/video/novel/{novelId}/chat` 创建 SubAgent
4. 服务端注入 `NovelContextProvider`，只暴露小说级上下文和已有 novel scope 资源统计
5. 默认 skill 为 `novel-resource-mgr`，默认 MCP scope 为 `video_workflow`，用于生成/管理 `scopeType="novel"` 的角色立绘和场景资源

小说级场景生成：
1. 调用方只传 `sceneNames`，不能传 `mode`；生成类型由服务端根据 `location_bible` 与资源占位自动裁决
2. 普通地点输出 `scene_<地点名>`
3. 带 2 个及以上真实子地点的父地点不是实际场景单图，占位和生成都只使用 `scene_<父地点名>_grid`；不得再创建同名 `scene_<父地点名>`
4. grid 工作流先用 `location_grid_style` 输出 `scene_<父地点名>_grid`，再把该参照图传给 `sub_location_style`，逐个生成子地点实际图 `scene_<子地点名>`
5. `sceneNames` 可以传占位资源的 `key` 或 `title`；服务端会把 `scene_...` key 解析回 `location_bible` 的真实标题，并把 `_grid` key 识别为 grid 工作流
6. grid 父地点永远不能单独用 `location_style` 裸生成，子地点实际图也不能裸生成

EP 级资源 agent：
1. 前端选择具体 episode
2. 会话 user scope 为 `video:{novelId}:{scriptKey}`
3. `POST /api/video/tasks` 创建 SubAgent
4. 服务端注入 `VideoContextProvider`，提供 `novel_id`、`script_id`、`script_key` 与 `init_result`
5. 默认 skill 为 `video-workflow`，默认 MCP scope 为 `video_workflow` + `subagent`，用于无文件系统环境下的 EP 级资源门禁、Prompt Optimizer 调度、review 门禁和产视编排

**视频生成工作流**：
1. 先提交 EP 级异步批量换装任务，等待 `completed`，并将换装图作为服装权威源
2. 主控只调用 `video_workflow__optimize_video_prompts`，不自行拼接或转述 Optimizer instruction，不直接调用 `subagent__run`
3. `optimize_video_prompts` 由服务端按 `scriptId` 读取当前 EP、前后一集原文窗口、资源状态和换装 URL，再确定性启动 Prompt Optimizer
4. Prompt Optimizer 内部最多 5 轮增量迭代：每轮调独立 Prompt Writer，再调独立 Reviewer；它维护 `iterationHistory`、`resolvedIssues`、`remainingIssues`、`doNotRegress` 和 `bestVersion`
5. 若 Reviewer 通过，`optimize_video_prompts` 返回 `status="passed"` 并默认保存 reviewed prompts；若 5 轮未通过，返回 `max_iterations` 和当前 best version；若发现门禁互相矛盾，返回 `conflict`
6. Seedance 是默认视频生成路径；HappyHorse 仅作兼容/测试路径；视频生成默认结构化传递 `ratio="9:16"`，不能只依赖 prompt 文本里的“9:16 尺寸”。
7. 连续 clip 生成时，`execute_video_prompt` 返回 `videoUrl` 与 `lastFrameUrl`；`clip_2+` 必须把上一轮返回的 `videoUrl` 作为 `previousVideoUrl`、`lastFrameUrl` 作为 `previousFrameUrl`，严禁自行拼接或推断 URL。服务层默认从上一 clip 裁最后 15 秒作为 `sourceVideoUrls`，并把上一 clip 最后一帧图片作为首帧/参考图参照；`lastFrameUrl` 由视频生成 FC 直接返回，或由独立 `FC_EXTRACT_LAST_FRAME_URL` 服务端提取，应用层不下载视频取帧。视频产物资源必须使用工具返回的 `videoKey`（形如 `video_clip_1`），不能覆盖原始 `视频Prompt` 的 `clip_1` key。

**EP Prompt Optimizer 调试 SOP**：
适用场景：调整 `video-workflow`、`video-prompt-optimizer`、`video-skill-reviewer` 或资源门禁后，需要验证主控、Optimizer、Writer、Reviewer 的实际调度链路。
1. 先确认 EP 资源状态，不要直接启动生成：
```
pnpm --dir /path/to/Agent-Forge --silent run cli debug:mcp-call '{"provider":"video_workflow","name":"get_status","arguments":{"scriptId":"<scriptId>"}}'
```
验收：`portraits/scenes/costumes` 都是 `done=total`，且 `runningTasks` 为空；否则先处理资源门禁，不进入 Prompt Optimizer。
2. 通过 URL-only/CLI 启动 EP agent，消息必须明确“不要执行视频生成”：
```
pnpm --dir /path/to/Agent-Forge --silent run cli debug:mcp-call '{"provider":"agent_forge","name":"submit_ep_agent","arguments":{"novelId":"<novelId>","scriptId":"<scriptId>","scriptKey":"<scriptKey>","message":"执行 EP prompt 生成流程；使用 Prompt Optimizer 最多 5 轮增量迭代；通过后保存 reviewed prompts；不要执行视频生成。"}}'
```
记录返回的 `subagent_id` 和 `session_id`，后续禁止丢失这些 ID。
3. 观察顶层事件流：
```
pnpm --dir /path/to/Agent-Forge --silent run cli debug:subagent-events '{"subagentId":"<subagent_id>","timeoutMs":180000,"showText":false}'
```
顶层验收：应看到 `video_workflow__get_status`、必要时 `video_workflow__get_episode`，然后只出现一次 `video_workflow__optimize_video_prompts`。顶层主控不应直接调用 `subagent__run`，也不应直接循环调用 Prompt Writer / Reviewer。
4. 抽取顶层 session 工具调用和工具结果：
```
pnpm --dir /path/to/Agent-Forge --silent run cli debug:session-tools '{"sessionId":"<session_id>","includeToolResults":true,"includeArguments":true,"resultMaxChars":50000}'
```
验收：`optimize_video_prompts` 的 arguments 只应包含当前 `scriptId` 以及保存/停止选项，不应包含 EP 原文。工具结果应包含 `optimizerTaskId`、`optimizerAgentId`、`iterationCount`、`promptCount`、`savedPrompts`、`remainingIssues`。
5. 如 `optimize_video_prompts` 返回 `optimizerAgentId`，立即抓嵌套 trace：
```
pnpm --dir /path/to/Agent-Forge --silent run cli debug:mcp-call '{"provider":"subagent","name":"get_trace","arguments":{"agentId":"<optimizerAgentId>","tree":true}}'
```
该 trace 是内存态调试数据，进程重启后可能不可用；持久证据以 session tools 中的 tool result 为准。
6. Optimizer 内部验收：
- 每轮必须有独立 Prompt Writer 和独立 Reviewer。
- 最多 5 轮，且每轮更新 `iterationHistory`。
- 服务端必须完整持久化 `latestPromptJson`、`latestReviewJson`、`iterationHistory`、`doNotRegress`；下一轮 Writer 输入使用 canonical 原文 + 上轮 prompt 摘要、阻塞 issue 摘要、历史轮次摘要和 `doNotRegress`，避免让 LLM 在整段历史里自行拼接。
- Writer 输出后，服务端先确定性校验 prompt JSON 形状：`key/title/prompt/definition` 必须非空、`duration` 必须在 1-60、`refUrls` 只能是当前 EP `Canonical Resource Status` 中的图片 URL。上一段尾帧、15s 视频参照、压缩图路径等承接资源由视频生成服务层注入，不允许写进 prompt JSON。校验失败时作为 blocking review 进入下一轮，而不是让 Optimizer 工具直接失败。
- Reviewer issue 应有稳定 `issueId` / `rule` / `blocking`，便于区分 `resolvedIssues`、`remainingIssues`、`newIssues`。
- `status="passed"` 时 `optimize_video_prompts` 才会保存 reviewed prompt；`max_iterations` / `conflict` / `failed` 均不得保存 reviewed prompt，不得产视。
7. 停止与恢复规则：
- 用户要求停止调试时，先取消顶层 `subagent_id`：`curl -X POST http://localhost:8001/api/subagents/<subagent_id>/cancel`。
- 如果返回 “not found or already finished”，不得为了看 trace 重新执行；先用 `debug:subagent-get`、`debug:session-tools` recall 已持久化结果。
- `interrupted` 表示 partial context 已保存，不自动重跑；继续前必须基于已有 session 续写。
8. 保存结果验收：
- 只有 `optimize_video_prompts` 返回 `passed` 时，才应出现已保存的 reviewed prompt；主控通常不直接调用 `save_reviewed_video_prompt`。
- 保存的 prompt JSON data 必须包含 `iterationCount`、`iterationHistory`、`bestVersion`、`resolvedIssues`、`remainingIssues`、`doNotRegress` 和 `optimizerSummary`，保证 UI 可查看版本路径和反馈历史。
- 用户未明确要求生成视频时，不应出现 `execute_video_prompt`。

前端兼容性：`/api/video/tasks` 与 `/api/video/novel/{novelId}/chat` 都返回 `subagent_id`，并同时保留 `task_id` 作为旧字段别名；前端以 `subagent_id` 连接 `/api/subagents/{id}/events`。

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
