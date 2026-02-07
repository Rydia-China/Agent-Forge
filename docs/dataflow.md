# 跨边界数据流

## Agent Forge ↔ 后端
- Agent Forge 通过 `/api/*` route handlers 代理请求到后端 `:8000`
- CORS 全开放（所有 origin）

## cocos ↔ Agent Forge
- cocos 直接请求 Agent Forge `:8001`
