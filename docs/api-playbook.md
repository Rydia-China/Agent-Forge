# API Playbook

给 AI agent 的操作手册。记录接口之间的因果关系和调用次序——这些信息无法从代码推断。

> 验证系统状态时使用 `curl http://localhost:8001/...`

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
2. `buildSystemPrompt()` — 查 DB 注入 skill 索引
3. `registry.listAllTools()` — 收集所有 provider 的 tools
4. LLM 调用（OpenAI format）
5. 若 LLM 返回 `tool_calls` → `registry.callTool()` 执行 → 结果追加到 messages → 回到步骤 4
6. 若 LLM 返回纯文本 → 返回最终 reply

**关键**：一次 chat 可能触发多轮 tool 调用（最多 20 轮）。每轮可调用多个 tools。

## 双入口等价性

REST API (`/api/*`) 和 MCP tools（agent 内部 / `/mcp` 外部）**共享同一 service layer**。
通过任一入口的变更，对另一入口**立即可见**。

示例：通过 `curl POST /api/skills` 创建的 skill，agent 下一轮 chat 即可使用。

## 验证清单

以下是端到端验证的 **推荐调用顺序**（每步验证上一步的副作用）：

### 1. Skill CRUD
```bash
# 创建
curl -X POST http://localhost:8001/api/skills \
  -H 'Content-Type: application/json' \
  -d '{"name":"test-skill","description":"A test skill","content":"# Test\nThis is test content."}'

# 列表（应包含 test-skill）
curl http://localhost:8001/api/skills

# 读取
curl http://localhost:8001/api/skills/test-skill

# 导出为 SKILL.md
curl -H 'Accept: text/markdown' http://localhost:8001/api/skills/test-skill

# 更新
curl -X PUT http://localhost:8001/api/skills/test-skill \
  -H 'Content-Type: application/json' \
  -d '{"description":"Updated description"}'

# 删除（最后做，或跳过以保留给后续测试）
curl -X DELETE http://localhost:8001/api/skills/test-skill
```

### 2. MCP CRUD
```bash
# 创建 dynamic MCP（注意 code 是 JS，必须导出 listTools/callTool）
curl -X POST http://localhost:8001/api/mcps \
  -H 'Content-Type: application/json' \
  -d '{
    "name":"echo",
    "description":"Echo tool for testing",
    "code":"module.exports={listTools:async()=>[{name:\"echo\",description:\"Echo input\",inputSchema:{type:\"object\",properties:{text:{type:\"string\"}},required:[\"text\"]}}],callTool:async(name,args)=>({content:[{type:\"text\",text:args.text}]})}"
  }'
# 响应中检查 loadError 是否为空

# 列表
curl http://localhost:8001/api/mcps

# 详情（含 code）
curl http://localhost:8001/api/mcps/echo

# 更新
curl -X PUT http://localhost:8001/api/mcps/echo \
  -H 'Content-Type: application/json' \
  -d '{"description":"Updated echo"}'

# 删除
curl -X DELETE http://localhost:8001/api/mcps/echo
```

### 3. Agent Chat（依赖步骤 1/2 的数据）
```bash
# 基本对话
curl -X POST http://localhost:8001/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"列出所有 skills"}'

# 带 session 继续对话
curl -X POST http://localhost:8001/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"读取第一个 skill 的全文","session_id":"<上一步返回的 session_id>"}'
```

### 4. asMCP（外部 agent 入口）
```bash
# 列出可用 tools（MCP protocol JSON-RPC）
curl -X POST http://localhost:8001/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# 列出 resources（skills）
curl -X POST http://localhost:8001/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"resources/list"}'

# 通过 MCP 调用 agent
curl -X POST http://localhost:8001/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"agent__chat","arguments":{"message":"hello"}}}'
```

## Tool 命名规则

Agent 内部的 tool name 格式为 `{provider}__{tool}`：
- `skills__list`, `skills__get`, `skills__create` …
- `mcp_manager__list`, `mcp_manager__create` …
- Dynamic MCP: `{mcp_name}__{tool_name}`（如 `echo__echo`）
- asMCP 额外暴露: `agent__chat`
