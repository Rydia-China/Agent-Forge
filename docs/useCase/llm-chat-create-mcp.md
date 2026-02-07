# Use Case: LLM Chat 创建 Dynamic MCP

## 场景
用户通过 `POST /api/chat` 多轮对话，要求 agent 创建一个 dynamic MCP server。
agent 应先读取内置的 `dynamic-mcp-builder` skill 获取沙盒规范和代码结构，再按规范编写 JS 代码并创建 MCP。

## 前置条件
- 服务已启动，LLM API key 已配置
- 内置 skill `dynamic-mcp-builder` 已在 system prompt 的 Available Skills 索引中可见

## 验证步骤

> 所有步骤建议加 `"logs": true`，完整对话日志会写入 `temp/` 方便回溯。

### 1. 确认内置 skill 可见
```bash
curl -s -X POST http://localhost:8001/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"你知道怎么创建 MCP 吗？", "logs": true}'
```
期望：返回 `session_id`（非空）和 `reply`（非空）。
agent 不调用 tool 就能提及 `dynamic-mcp-builder`（因为内置 skill 已注入 system prompt）。

记录响应中的 `session_id`。

### 2. 通过 chat 创建 MCP
使用步骤 1 返回的 `session_id` 延续对话：
```bash
curl -s -X POST http://localhost:8001/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"请帮我创建一个查询 IP 地理位置的 MCP，用 ip-api.com 的免费接口，支持查询单个 IP 的地理位置信息", "session_id":"<步骤 1 的 session_id>", "logs": true}'
```
期望行为链（检查 `temp/` 日志确认）：
1. agent 看到 system prompt 中 `dynamic-mcp-builder` 的 description，判断相关
2. agent 调用 `skills__get` 读取 `dynamic-mcp-builder` 全文（返回 production version），获取沙盒规范和代码结构
3. agent 按规范编写 JS 代码：`module.exports = { tools: [...], async callTool(name, args) {...} }`
4. agent 使用沙盒全局 `fetch()` 调用外部 API（非 `require` / `http`）
5. agent 调用 `mcp_manager__create` 提交代码
6. reply 中确认创建成功（v1，自动提升为 production），且无 loadError

### 3. 验证 MCP 已注册（多轮）
继续使用同一 `session_id`：
```bash
curl -s -X POST http://localhost:8001/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"列出所有 MCP servers", "session_id":"<同一 session_id>", "logs": true}'
```
期望：agent 调用 `mcp_manager__list`，返回结果中包含步骤 2 创建的 MCP（runtime + database 均有记录），database 记录包含 `productionVersion: 1`。

### 4. 端到端验证：触发 tool 调用（多轮）
继续使用同一 `session_id`：
```bash
curl -s -X POST http://localhost:8001/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"帮我查一下 8.8.8.8 的地理位置", "session_id":"<同一 session_id>", "logs": true}'
```
期望：agent 识别到新注册的 MCP tool，调用它查询 IP 地理位置，reply 中包含地理位置信息（如国家、城市等）。

### 5. 验证创建质量
检查 `temp/` 日志中 agent 提交的代码是否符合 `dynamic-mcp-builder` 规范：
- 使用 `module.exports = { tools, callTool }` 结构
- 使用沙盒全局 `fetch()` 调用外部 API（非 `require("http")` / Node.js API）
- tool description 具体明确
- inputSchema 中参数有 description
- 错误处理返回人类可读信息

### 6. loadError 修复流程
如果步骤 2 返回中出现 loadError，继续对话要求修复：
```bash
curl -s -X POST http://localhost:8001/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"创建失败了，请修复代码并重新加载", "session_id":"<同一 session_id>", "logs": true}'
```
期望：agent 调用 `mcp_manager__update_code` 推送修复后的新版本（v2），auto-promote 到 production 并自动 reload sandbox。无需再单独调用 `mcp_manager__reload`。

### 7. 版本更新
要求 agent 对已创建的 MCP 做一次优化，产生 v2（若步骤 6 已产生 v2 则此步产生 v3）：
```bash
curl -s -X POST http://localhost:8001/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"帮我优化一下这个 IP 地理位置 MCP，给返回结果加上 ISP 和时区信息", "session_id":"<同一 session_id>", "logs": true}'
```
期望：agent 调用 `mcp_manager__update_code` 推送新版本，auto-promote 到 production 并 reload sandbox。

### 8. 版本回滚
```bash
curl -s -X POST http://localhost:8001/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"回滚到上一个版本", "session_id":"<同一 session_id>", "logs": true}'
```
期望：agent 调用 `mcp_manager__list_versions` 查看版本列表，然后调用 `mcp_manager__set_production` 将 production 切回上一版本，sandbox 自动 reload。

### 9. 清理
```bash
curl -s -X POST http://localhost:8001/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"删除刚才创建的 IP 地理位置 MCP", "session_id":"<同一 session_id>"}'
```
期望：agent 调用 `mcp_manager__delete`，删除 MCP server 及其所有版本。
