# 短期目标

> 唯一规划文件。所有条目完成前不得开发新功能。
> 完成后删除该条目并提交。新需求追加到末尾。

## Phase 1 — 数据层
- Prisma schema: Skill 模型（agentskills.io 标准对齐）
- Prisma schema: McpServer 模型（动态 MCP 存储）
- db push + 验证

## Phase 2 — MCP 基础设施
- MCP 接口类型 `McpProvider`（基于 @modelcontextprotocol/sdk types）
- MCP Registry 单例（聚合 static + dynamic MCP，tool 分发）
- Static MCP: skills-mcp（CRUD + SKILL.md 导入导出）
- Static MCP: mcp-manager（动态 MCP 注册/卸载/重载）

## Phase 3 — 沙盒与动态 MCP
- SandboxManager（isolated-vm，内存/CPU 限制）
- 沙盒 Bridge（bridge.fetch / bridge.log / bridge.getSkill）
- Dynamic MCP 加载流程（DB → sandbox → Registry 注册）

## Phase 4 — Agent Core
- LLM Client（OpenAI-compatible，环境变量配置）
- Agent tool-use loop（messages → LLM → tool_calls → MCP → loop）
- System prompt 动态构建（skill metadata 注入）
- ChatSession 内存存储

## Phase 5 — API 路由
- POST /api/chat（streaming SSE）
- GET/POST /api/skills（REST + SKILL.md 导入导出）
- GET/POST /api/mcps（REST）

## Phase 6 — asMCP
- as-mcp-server（@modelcontextprotocol/sdk Server）
- POST /mcp 端点（Streamable HTTP transport）
- 暴露 tools + skills resources + agent chat tool

## Phase 7 — UI
- 基础 Chat UI
