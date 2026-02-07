# Use Case: LLM Chat 创建 Skill

## 场景
用户通过 `POST /api/chat` 多轮对话，要求 agent 创建一个 skill。

## 前置条件
- 服务已启动，LLM API key 已配置

## 验证步骤

> 所有步骤建议加 `"logs": true`，完整对话日志会写入 `temp/` 方便回溯。

### 1. 确认 LLM 连通
```bash
curl -s -X POST http://localhost:8001/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"hello", "logs": true}'
```
期望：返回 `session_id`（非空）和 `reply`（非空）。
记录 `session_id`，后续步骤复用。

### 2. 通过 chat 创建 skill
```bash
curl -s -X POST http://localhost:8001/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"请帮我创建一个 Git commit 规范的 skill，要求：commit 类型限定 feat/fix/refactor/docs/chore，格式为 type(scope): description", "logs": true}'
```
期望：agent 根据 tool 定义自行组织 name/description/content，调用 `skills__create`，reply 中确认创建成功。
记录响应中的 `session_id`。

### 3. 验证 skill 已持久化（多轮）
使用步骤 2 返回的 `session_id` 延续对话：
```bash
curl -s -X POST http://localhost:8001/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"列出所有 skills", "session_id":"<步骤 2 的 session_id>", "logs": true}'
```
期望：agent 能列出步骤 2 创建的 skill（skill 索引已注入 system prompt，无需调用 tool）。

### 4. 验证 skill 内容可读取（多轮）
继续使用同一 `session_id`：
```bash
curl -s -X POST http://localhost:8001/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"我想看看关于 Git commit 规范的 skill 全文", "session_id":"<同一 session_id>", "logs": true}'
```
期望：agent 根据上下文匹配到之前创建的 skill，调用 `skills__get`，返回其 content。

### 5. 验证 system prompt 注入（新对话）
`buildSystemPrompt()` 每轮都从 DB 查询，新 skill 已注入 Available Skills 段。
发起一个新对话（不传 `session_id`）：
```bash
curl -s -X POST http://localhost:8001/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"你知道哪些 skills？", "logs": true}'
```
期望：agent 不调用 tool 就能提到步骤 2 创建的 skill（因为已在 system prompt 的 Available Skills 段中）。

## 清理
```bash
curl -s -X POST http://localhost:8001/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"删除刚才创建的 Git commit 规范 skill", "session_id":"<同一 session_id>"}'
```
