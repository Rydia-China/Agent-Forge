/**
 * Built-in Skill: dynamic-mcp-builder
 *
 * 标准 SKILL.md 格式（YAML frontmatter + Markdown body）以字符串形式内嵌。
 * 由 builtins/index.ts 统一加载解析。
 */
export const raw = `---
name: dynamic-mcp-builder
description: Create dynamic MCP servers that run in this system's isolated-vm sandbox. Use when asked to build integrations, tools, API connectors, or any new MCP capability.
tags:
  - meta
  - core
  - mcp
---
# Dynamic MCP Builder

## 概述

本系统的 Dynamic MCP 是运行在 \`isolated-vm\` 沙盒中的 JavaScript 代码。
它不是独立的 Node.js 服务，而是一段 JS 脚本，通过 \`module.exports\` 暴露 tools 给 agent 使用。

与标准 MCP Server 的关键差异：
- **不是独立进程** — 代码在 V8 隔离沙盒中执行，共享宿主进程
- **无 Node.js API** — 没有 \`require\`、\`fs\`、\`path\`、\`Buffer\`、\`process\` 等
- **无 npm 依赖** — 只能使用原生 JS（ES2022）
- **通过 bridge 与外界交互** — \`bridge.fetch()\`、\`bridge.log()\`、\`bridge.getSkill()\`

## 沙盒 API

### bridge.fetch(url, options?)

发起 HTTP 请求。这是与外部 API 交互的唯一方式。

\`\`\`js
// GET
const resp = await bridge.fetch("https://api.example.com/data");
// resp = { status: 200, body: "..." }

// POST with headers
const resp = await bridge.fetch("https://api.example.com/items", {
  method: "POST",
  headers: { "Content-Type": "application/json", "Authorization": "Bearer xxx" },
  body: JSON.stringify({ name: "test" }),
});
const data = JSON.parse(resp.body);
\`\`\`

**注意**：返回值是 \`{ status: number, body: string }\`，不是标准的 \`Response\` 对象。
body 始终是字符串，需要手动 \`JSON.parse()\`。

### bridge.log(...args)

输出日志到宿主控制台（前缀 \`[sandbox:name]\`）。仅用于调试。

\`\`\`js
bridge.log("Processing request:", toolName);
\`\`\`

### bridge.getSkill(name)

从数据库读取一个 Skill 的 content。返回 \`string | null\`。
用于在 MCP tool 执行时动态加载 Skill 知识。

\`\`\`js
const instructions = await bridge.getSkill("api-conventions");
if (instructions) {
  // 使用 skill 中的知识
}
\`\`\`

## 代码结构（必须遵循）

\`\`\`js
// module.exports 包含两个成员：tools 数组 和 callTool 函数

module.exports = {
  // tools: MCP Tool 定义数组（JSON Schema 格式）
  tools: [
    {
      name: "tool_name",
      description: "What this tool does. Be specific — agent 根据这段文字决定何时调用。",
      inputSchema: {
        type: "object",
        properties: {
          param1: { type: "string", description: "参数说明" },
          param2: { type: "number", description: "参数说明" },
        },
        required: ["param1"],
      },
    },
  ],

  // callTool: 处理 tool 调用
  async callTool(name, args) {
    switch (name) {
      case "tool_name": {
        // 实现逻辑...
        // 返回字符串（自动包装为 text content）
        return "result text";
        // 或返回完整 CallToolResult
        // return { content: [{ type: "text", text: "result" }] };
      }
      default:
        return { content: [{ type: "text", text: "Unknown tool: " + name }] };
    }
  },
};
\`\`\`

## 运行约束

- **内存限制**：128 MB（超出则 isolate 被终止）
- **执行超时**：30 秒（单次 tool 调用）
- **无全局状态持久化** — reload 后所有状态丢失。需要持久化则通过 bridge.fetch 调用外部存储。
- **无定时器** — 没有 \`setTimeout\`、\`setInterval\`
- **无异步初始化** — 模块顶层代码同步执行，async 仅在 callTool 内部使用

## 完整示例：GitHub Issue 查询器

\`\`\`js
const GITHUB_API = "https://api.github.com";

module.exports = {
  tools: [
    {
      name: "list_issues",
      description: "List open issues for a GitHub repository.",
      inputSchema: {
        type: "object",
        properties: {
          owner: { type: "string", description: "Repository owner" },
          repo: { type: "string", description: "Repository name" },
          limit: { type: "number", description: "Max issues to return (default 10)" },
        },
        required: ["owner", "repo"],
      },
    },
    {
      name: "get_issue",
      description: "Get details of a specific GitHub issue by number.",
      inputSchema: {
        type: "object",
        properties: {
          owner: { type: "string", description: "Repository owner" },
          repo: { type: "string", description: "Repository name" },
          number: { type: "number", description: "Issue number" },
        },
        required: ["owner", "repo", "number"],
      },
    },
  ],

  async callTool(name, args) {
    const headers = {
      "Accept": "application/vnd.github.v3+json",
      "User-Agent": "agent-forge-mcp",
    };

    switch (name) {
      case "list_issues": {
        const limit = args.limit || 10;
        const url = GITHUB_API + "/repos/" + args.owner + "/" + args.repo
          + "/issues?state=open&per_page=" + limit;
        const resp = await bridge.fetch(url, { headers });

        if (resp.status !== 200) {
          return "GitHub API error (" + resp.status + "): " + resp.body;
        }

        const issues = JSON.parse(resp.body);
        const lines = issues.map(function(i) {
          return "#" + i.number + " " + i.title + " [" + i.user.login + "]";
        });
        return lines.join("\\n") || "No open issues.";
      }

      case "get_issue": {
        const url = GITHUB_API + "/repos/" + args.owner + "/" + args.repo
          + "/issues/" + args.number;
        const resp = await bridge.fetch(url, { headers });

        if (resp.status !== 200) {
          return "GitHub API error (" + resp.status + "): " + resp.body;
        }

        const issue = JSON.parse(resp.body);
        return [
          "# #" + issue.number + " " + issue.title,
          "State: " + issue.state,
          "Author: " + issue.user.login,
          "Created: " + issue.created_at,
          "Labels: " + issue.labels.map(function(l) { return l.name; }).join(", "),
          "",
          issue.body || "(no description)",
        ].join("\\n");
      }

      default:
        return "Unknown tool: " + name;
    }
  },
};
\`\`\`

## 创建流程

1. **明确需求** — 要连接什么 API？需要哪些操作？
2. **设计 tools** — 每个 tool 对应一个明确操作，description 写清楚用途
3. **编写代码** — 遵循上述代码结构，使用 bridge.fetch 调用外部 API
4. **创建 MCP** — 调用 \`mcp_manager__create\` 提交代码
5. **验证** — 检查返回信息中是否有 loadError。如有则修复代码后 \`mcp_manager__update_code\` + \`mcp_manager__reload\`
6. **测试** — 通过 agent chat 触发 tool 调用，验证端到端可用

## 可用工具

| 操作 | 工具 |
|------|------|
| 查看所有 MCP | \`mcp_manager__list\` |
| 查看代码 | \`mcp_manager__get_code\` |
| 创建 | \`mcp_manager__create\` |
| 更新代码 | \`mcp_manager__update_code\` |
| 启用/禁用 | \`mcp_manager__toggle\` |
| 删除 | \`mcp_manager__delete\` |
| 热重载 | \`mcp_manager__reload\` |

## 常见错误

### "xxx is not defined"
沙盒中没有 Node.js API。不能用 \`require\`、\`Buffer\`、\`console.log\`（用 \`bridge.log\`）。

### "Script execution timed out"
callTool 中的异步操作超过 30 秒。优化请求或减少循环次数。

### "Isolate was disposed"
内存超过 128MB。避免在模块作用域堆积大数据结构。

### Tool 不出现在 agent 可用列表中
检查 \`mcp_manager__create\` 返回是否有 loadError。
确认 tools 数组在 \`module.exports.tools\` 中正确定义。

## 设计最佳实践

- **Tool description 要具体** — agent 根据 description 决定何时调用，模糊的描述导致误用或漏用
- **错误信息要人类可读** — agent 会将 tool 返回值传递给用户，确保错误信息有上下文
- **参数要有 description** — inputSchema 中每个属性都应有 description 字段
- **幂等优先** — 尽量设计幂等操作，多次调用不产生副作用
- **先只读后写入** — 先实现 list/get 类 tool，验证 API 连通后再加 create/update/delete
`;
