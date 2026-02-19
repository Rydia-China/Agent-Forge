# 短期目标

> 唯一规划文件。所有条目完成前不得开发新功能。
> 完成后删除该条目并提交。新需求追加到末尾。

- biz-db SQL 安全加固：ERASE 拦截加固、系统表访问阻断、多语句注入防护、语句类型白名单
- API 一等公民：声明式 SQL 操作绑定 biz-db，版本管理 + HTTP 公开端点 + MCP tools + 自动生成文档
- OSS 通用上传能力：oss-service + MCP provider + HTTP 上传端点 + builtin skill
- biz-db 用户数据隔离：表名 userName 前缀自动隔离、upgrade_global 单向升级、LLM 无感知
- 多 Agent 并行仪表盘：AgentPanel 组件提取 + 状态机（idle/running/needs_attention/done）+ 多 panel 横向布局 + 事件内嵌处理

