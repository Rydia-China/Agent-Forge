# Use Case: LLM Chat 创建 Skill

## 场景
用户通过 `POST /api/chat` 多轮对话，要求 agent 创建一个 skill。
agent 应先读取内置的 `skill-creator` skill 获取创建规范，再按规范执行创建。

## 前置条件
- 服务已启动，LLM API key 已配置
- 内置 skill `skill-creator` 已在 system prompt 的 Available Skills 索引中可见

## 验证步骤

> 所有步骤建议加 `"logs": true`，完整对话日志会写入 `temp/` 方便回溯。

### 1. 确认 LLM 连通 & 内置 skill 可见
```bash
curl -s -X POST http://localhost:8001/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"你知道哪些 skills？", "logs": true}'
```
期望：返回 `session_id`（非空）和 `reply`（非空）。
agent 不调用 tool 就能列出 `skill-creator` 和 `dynamic-mcp-builder`（因为内置 skill 已注入 system prompt）。

### 2. 通过 chat 创建 skill
```bash
curl -s -X POST http://localhost:8001/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"请帮我创建一个 Git commit 规范的 skill，要求：commit 类型限定 feat/fix/refactor/docs/chore，格式为 type(scope): description", "logs": true}'
```
期望行为链（检查 `temp/` 日志确认）：
1. agent 看到 system prompt 中 `skill-creator` 的 description，判断相关
2. agent 调用 `skills__get` 读取 `skill-creator` 全文，获取创建规范
3. agent 按规范组织 name（kebab-case）、description（回答“做什么”和“何时用”）、content（结构化 Markdown）
4. agent 调用 `skills__create` 写入数据库
5. reply 中确认创建成功

记录响应中的 `session_id`。

### 3. 验证 skill 已持久化（多轮）
使用步骤 2 返回的 `session_id` 延续对话：
```bash
curl -s -X POST http://localhost:8001/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"列出所有 skills", "session_id":"<步骤 2 的 session_id>", "logs": true}'
```
期望：agent 能列出步骤 2 创建的 skill + 两个内置 skill。

### 4. 验证 skill 内容可读取（多轮）
继续使用同一 `session_id`：
```bash
curl -s -X POST http://localhost:8001/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"我想看看关于 Git commit 规范的 skill 全文", "session_id":"<同一 session_id>", "logs": true}'
```
期望：agent 根据上下文匹配到之前创建的 skill，调用 `skills__get`，返回其 content。

### 5. 验证创建质量
检查步骤 4 返回的 content 是否符合 `skill-creator` 中定义的规范：
- name 是否 kebab-case
- description 是否回答了“做什么”和“何时用”
- content 是否有清晰的标题层级和具体示例

## 清理
```bash
curl -s -X POST http://localhost:8001/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"删除刚才创建的 Git commit 规范 skill", "session_id":"<同一 session_id>"}'
```
