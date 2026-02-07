# 系统拓扑

```
cocos (游戏前端) <---> Agent Forge (:8001) <---> 后端 API (:8000)
```

## 服务边界
- Agent Forge: Web UI + 代理层，端口 8001
- 后端 API: 独立进程，端口 8000，代码库 `noval.demo.2`
- cocos 前端: 独立项目，通过 Agent Forge 与后端交互
