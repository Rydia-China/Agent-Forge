# 跨边界数据流

仅记录跨系统边界的外部依赖，内部流转从 codebase 推断。

## 外部依赖
- LLM API: 出站 HTTPS (OpenAI-compatible)，密钥通过 `LLM_API_KEY` 环境变量
- asMCP: 入站 HTTP `POST /mcp`，当前无鉴权
- CORS 全开放（所有 origin）
