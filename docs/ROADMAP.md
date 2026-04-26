# 短期目标

> 唯一规划文件。所有条目完成前不得开发新功能。
> 完成后删除该条目并提交。新需求追加到末尾。

## 2026-04-26 — 恢复 /video 本地剧本上传落库业务流
来源：本地 `feat/hierarchical-agent` 分支，核心提交 `f8d85cf feat(video): 实现小说级资源管理`。
范围：仅迁移 `/video` 业务逻辑，将 JSON 剧本上传解析后写入本地 biz-db，并从本地 `novels`、`novel_scripts`、`domain_resources` 读取。
排除：不迁移该分支中的 agent、subagent、scheduler、runtime、MCP loading、模型/provider 等优化。
