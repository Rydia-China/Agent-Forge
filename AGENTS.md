# Agent Forge

## 文档原则
文档只记录代码无法自我表达的结构性信息。
- 代码能表达的不写
- 单文件能推断的不写
- 跨组件/跨系统的拓扑、边界、数据流向写

## 索引
- `docs/topology.md` — 系统拓扑与服务边界
- `docs/dataflow.md` — 跨边界数据流

## 端口
- Web UI: 8001 (env `PORT`)
- API Server: 8000 (后端独立服务)

## 参照项目
- `/Users/rydia/Project/mob.ai/git/noval.demo.2` — 后端参照
- cocos 前端 — 游戏客户端参照
- 本系统功能独立，不依赖上述项目运行
