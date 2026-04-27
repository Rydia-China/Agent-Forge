# CLI Layer

Agent Forge 提供三种平行的调用方式：

1. **HTTP API** — REST 接口，适合 Web 客户端
2. **MCP Tools** — Model Context Protocol，适合 AI Agent
3. **CLI** — 命令行接口，适合脚本和自动化

三者都直接调用 service 层，不存在相互依赖或包装关系。

## 架构

```
┌─────────────────────────────────────────────────────────┐
│  External Clients                                       │
│  (HTTP / MCP / CLI)                                     │
└─────────────────────────────────────────────────────────┘
                      │
        ┌─────────────┼─────────────┐
        │             │             │
┌───────▼────────┐ ┌──▼──────────┐ ┌▼────────────┐
│  API Routes    │ │ MCP Provider│ │ CLI Commands│
│  (HTTP layer)  │ │ (Tool layer)│ │ (CLI layer) │
├────────────────┤ ├─────────────┤ ├─────────────┤
│ • Zod validate │ │ • Zod valid │ │ • Zod valid │
│ • Call service │ │ • Call svc  │ │ • Call svc  │
│ • Return JSON  │ │ • Return    │ │ • Print out │
└───────┬────────┘ └──┬──────────┘ └┬────────────┘
        │             │             │
        └─────────────┼─────────────┘
                      │
              ┌───────▼────────┐
              │  Service Layer │
              └────────────────┘
```

## 使用方法

### 查看所有命令

```bash
pnpm cli --help
```

### 命令格式

```bash
pnpm cli <command> '<json-args>'
```

### 示例

#### Skills 管理

```bash
# 列出所有 skills
pnpm cli skills:list '{}'

# 获取特定 skill
pnpm cli skills:get '{"name":"video-workflow"}'

# 创建新 skill
pnpm cli skills:create '{
  "name": "my-skill",
  "description": "My custom skill",
  "content": "# Instructions\n\nDo something...",
  "tags": ["custom"]
}'

# 导出 skill 为 SKILL.md
pnpm cli skills:export '{"name":"video-workflow"}'
```

#### OSS 操作

```bash
# 从 URL 上传文件
pnpm cli oss:upload-url '{
  "url": "https://example.com/image.png",
  "folder": "images"
}'

# 删除文件
pnpm cli oss:delete '{"objectName":"public/images/file.png"}'
```

#### Biz-DB 管理

```bash
# 列出所有表
pnpm cli biz-db:list-tables '{}'

# 获取表结构
pnpm cli biz-db:get-schema '{"tableName":"users"}'

# 创建表
pnpm cli biz-db:create-table '{
  "tableName": "products",
  "columns": [
    {"name": "id", "type": "serial", "nullable": false},
    {"name": "name", "type": "text", "nullable": false},
    {"name": "price", "type": "numeric", "nullable": false}
  ],
  "constraints": [
    {"type": "pk", "columns": ["id"]}
  ]
}'

# 对比声明与物理表
pnpm cli biz-db:diff-schema '{"tableName":"products"}'
```

#### Chat 会话

```bash
# 列出会话
pnpm cli chat:list-sessions '{}'

# 获取会话详情
pnpm cli chat:get-session '{"sessionId":"xxx"}'

# 删除会话
pnpm cli chat:delete-session '{"sessionId":"xxx"}'
```

#### Subagent 管理

```bash
# 获取 subagent 状态
pnpm cli subagent:get '{"subagentId":"xxx"}'

# 取消运行中的 subagent
pnpm cli subagent:cancel '{"subagentId":"xxx"}'
```

## 可用命令列表

### Skills
- `skills:list` — 列出所有 skills
- `skills:get` — 获取 skill 详情
- `skills:create` — 创建新 skill
- `skills:update` — 更新 skill（创建新版本）
- `skills:delete` — 删除 skill
- `skills:import` — 从 SKILL.md 导入
- `skills:export` — 导出为 SKILL.md
- `skills:set-production` — 设置生产版本
- `skills:list-versions` — 列出所有版本

### OSS
- `oss:upload-url` — 从 URL 上传文件
- `oss:upload-base64` — 上传 base64 数据
- `oss:delete` — 删除文件

### Biz-DB
- `biz-db:list-tables` — 列出所有表
- `biz-db:get-schema` — 获取表结构
- `biz-db:create-table` — 创建表
- `biz-db:alter-table` — 修改表结构
- `biz-db:drop-table` — 删除表
- `biz-db:diff-schema` — 对比声明与物理表

### Chat
- `chat:list-sessions` — 列出会话
- `chat:get-session` — 获取会话详情
- `chat:delete-session` — 删除会话

### Subagent
- `subagent:get` — 获取 subagent 状态
- `subagent:cancel` — 取消 subagent

## 开发

### 添加新命令

1. 在 `src/lib/cli/commands/` 下创建新文件
2. 使用 `registry.register()` 注册命令
3. 在 `src/lib/cli/index.ts` 中导入

示例：

```typescript
import { registry } from '../registry';
import * as myService from '@/lib/services/my-service';

registry.register({
  name: 'my:command',
  description: 'Do something',
  schema: myService.MyCommandParams,
  handler: async (args) => {
    const result = await myService.doSomething(args as Parameters<typeof myService.doSomething>[0]);
    console.log(JSON.stringify(result, null, 2));
  },
});
```

### 构建 CLI

```bash
pnpm build:cli
```

生成的可执行文件在 `dist/bin/agent-forge.js`。
