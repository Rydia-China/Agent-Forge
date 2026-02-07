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

## 关联系统
- 后端: `/Users/rydia/Project/mob.ai/git/noval.demo.2`
- 前端 (cocos): 独立项目，与本系统联合开发
