# 跨边界数据流

仅记录跨系统边界的外部依赖，内部流转从 codebase 推断。

## 外部依赖
- LLM API: 出站 HTTPS (OpenAI-compatible)，密钥通过 `LLM_API_KEY` 环境变量，地址、默认模型与 thinking 开关由 `LLM_BASE_URL` / `LLM_DEFAULT_MODEL` / `LLM_THINKING_MODE` 配置
- asMCP: 入站 HTTP `POST /mcp`，当前无鉴权
- CORS 全开放（所有 origin）

## 2026-04-26 /video 本地剧本导入
`/video` 小说数据源切回本地上传，不再通过远程 novel service 拉取列表。
外部边界是用户上传的 JSON 剧本文件；服务端校验后写入 biz-db 的 `novels`、`novel_scripts` 逻辑表，并初始化 versioned `KeyResource` 资源占位用于 UI 展示和后续生成。
恢复来源是本地 `feat/hierarchical-agent` 分支的业务提交，迁移时明确排除该分支里的 agent/subagent/runtime 优化。
