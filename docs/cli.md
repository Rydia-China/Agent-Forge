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

# 批量审计 production skill 是否包含旧术语
pnpm cli skills:audit-terms '{
  "names": ["video-workflow", "video-skill-reviewer"],
  "terms": ["old_tool_name", "deprecated_schema_name", "legacy_term"]
}'

# 查看命中上下文
pnpm cli skills:show-matches '{
  "name": "video-workflow",
  "terms": ["old_tool_name"],
  "contextLines": 2
}'

# 按字面量替换 skill 内容并发布新 production 版本
pnpm cli skills:replace-content '{
  "name": "video-workflow",
  "replacements": [
    {
      "search": "旧文本",
      "replace": "新文本"
    }
  ],
  "dryRun": false
}'
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

#### URL-only 调试

这些命令只通过 HTTP/MCP URL 调用本地服务，不直接 import service 层，适合复现 UI/Agent 的真实路径。

```bash
# 列出某个 MCP provider 的工具
pnpm cli debug:mcp-tools '{"provider":"agent_forge"}'

# 只输出工具名，并断言某些工具存在或不存在
pnpm cli debug:mcp-tools '{
  "provider": "video_workflow",
  "namesOnly": true,
  "required": ["get_status"],
  "forbidden": ["old_tool_name"]
}'

# 调用 MCP 工具
pnpm cli debug:mcp-call '{
  "provider": "agent_forge",
  "name": "submit_ep_agent",
  "arguments": {
    "novelId": "xxx",
    "scriptId": "xxx",
    "scriptKey": "EP1",
    "message": "帮我执行任务，生成视频前停止，不要执行视频生成。"
  }
}'

# 获取 subagent 状态
pnpm cli debug:subagent-get '{"subagentId":"xxx"}'

# 采样 subagent SSE 事件流；默认隐藏 delta 文本，只输出工具/状态事件和统计
pnpm cli debug:subagent-events '{"subagentId":"xxx","timeoutMs":30000}'

# 查看 session 完整内容
pnpm cli debug:session-get '{"sessionId":"xxx"}'

# 汇总 session 内的工具调用与参数
pnpm cli debug:session-tools '{"sessionId":"xxx"}'

# 只查看指定工具调用，避免输出过大
pnpm cli debug:session-tools '{
  "sessionId": "xxx",
  "toolNames": ["subagent__run"],
  "includeToolResults": true,
  "includeArguments": false,
  "resultMaxChars": 2000
}'
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
- `skills:audit-terms` — 批量统计 production skill 内容中的字面量术语
- `skills:show-matches` — 显示 production skill 术语命中的行上下文
- `skills:replace-content` — 对 production skill 做字面量替换并可发布新版本

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

### Debug URL
- `debug:mcp-tools` — 通过 HTTP URL 列出 MCP provider 工具
- `debug:mcp-call` — 通过 HTTP URL 调用 MCP tool
- `debug:subagent-get` — 通过 HTTP URL 获取 subagent 状态
- `debug:subagent-events` — 通过 HTTP URL 采样 subagent SSE 事件
- `debug:session-get` — 通过 HTTP URL 获取 session
- `debug:session-tools` — 通过 HTTP URL 汇总 session 工具调用和参数

### Resources
- `resources:backfill-video-prompts` — 将视频Prompt资源当前版本里的 `prompt/refUrls` 回填进 JSON data

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
