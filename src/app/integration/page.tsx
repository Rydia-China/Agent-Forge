"use client";

import { useState } from "react";
import { Typography, Card, Button, message, Tabs, ConfigProvider, theme as antTheme } from "antd";
import { CopyOutlined, CheckOutlined } from "@ant-design/icons";

const { Title, Paragraph, Text } = Typography;

export default function IntegrationGuidePage() {
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");

  const handleCopyMarkdown = async () => {
    const markdown = generateMarkdown();
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      message.success("已复制为 Markdown 格式");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      message.error("复制失败");
    }
  };

  const generateMarkdown = () => {
    return `# Agent-Forge Integration Guide

## System Overview

Agent-Forge is a standard MCP (Model Context Protocol) server that exposes:
- All internal tools as MCP tools
- Agent chat capability via \`agent__chat\` tool
- Skills as MCP resources (\`skill://\` URIs)
- Domain-specialized agents (main, video)

**Base URL**: \`http://localhost:8001\`
**MCP Endpoint**: \`POST /mcp\`

---

## Quick Start

### 1. Connect as MCP Client

\`\`\`json
{
  "mcpServers": {
    "agent-forge": {
      "url": "http://localhost:8001/mcp"
    }
  }
}
\`\`\`

### 2. Discover Available Tools

\`\`\`bash
curl -X POST http://localhost:8001/mcp \\
  -H "Content-Type: application/json" \\
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list"
  }'
\`\`\`

Returns all tools in format \`providerName__toolName\`.

### 3. Call Agent Chat

\`\`\`bash
curl -X POST http://localhost:8001/mcp \\
  -H "Content-Type: application/json" \\
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "name": "agent__chat",
      "arguments": {
        "message": "Hello, what can you do?"
      }
    }
  }'
\`\`\`

---

## MCP Endpoints

### Full Server (All Tools)
- **Endpoint**: \`POST /mcp\`
- **Tools**: All providers, qualified names (\`provider__tool\`)
- **Resources**: All skills (\`skill://skillName\`)
- **Special Tool**: \`agent__chat\` for agent conversations

### Scoped Server (Single Provider)
- **Endpoint**: \`POST /mcp/{provider}\`
- **Tools**: Single provider only, unqualified names
- **Example**: \`POST /mcp/biz_db\` exposes only \`biz_db\` tools

---

## Agent Chat API

### Unified Entry Point (Recommended)

\`\`\`bash
curl -X POST http://localhost:8001/api/agent/chat \\
  -H "Content-Type: application/json" \\
  -d '{
    "domain": "main",
    "message": "Your message here",
    "session_id": "optional-session-id",
    "user": "optional-username",
    "model": "optional-model-override",
    "skills": ["optional-skill-names"],
    "images": ["optional-image-urls"]
  }'
\`\`\`

**Response**:
\`\`\`json
{
  "session_id": "ses_...",
  "reply": "Agent's response"
}
\`\`\`

### Available Domains
- \`main\` - General-purpose agent
- \`video\` - Video generation workflow agent

### Session Management
- First request: omit \`session_id\`, server creates new session
- Subsequent requests: include \`session_id\` to continue conversation
- Sessions persist in DB, survive restarts

---

## Using Agent-Forge as Subagent

### Via MCP Tool (from another agent)

\`\`\`typescript
// Call agent__chat tool
const result = await callTool("agent__chat", {
  message: "Analyze this codebase structure",
  session_id: "optional-session-id"
});
\`\`\`

### Via REST API (from external system)

\`\`\`bash
curl -X POST http://localhost:8001/api/agent/chat \\
  -H "Content-Type: application/json" \\
  -d '{
    "domain": "main",
    "message": "Your task here"
  }'
\`\`\`

### Domain Delegation (Cross-Domain Calls)

Main agent can delegate to video agent:

\`\`\`typescript
// Via agent__agent_delegate tool
const result = await callTool("agent__agent_delegate", {
  domain: "video",
  message: "Generate video script",
  context: { novelId: "123" }
});
\`\`\`

---

## MCP Discovery & Management

### List Static Providers (Built-in)

\`\`\`bash
curl http://localhost:8001/api/mcps/builtins
\`\`\`

Returns all built-in static providers:
- \`agent_forge\`, \`biz_db\`, \`langfuse_admin\`, \`langfuse\`, \`multimodal\`, \`oss\`, \`skills\`, \`subagent\`, \`video_mgr\`

### List Dynamic MCPs (User-Created)

\`\`\`bash
curl http://localhost:8001/api/mcps
\`\`\`

### Create Dynamic MCP

\`\`\`bash
curl -X POST http://localhost:8001/api/mcps \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "my_custom_mcp",
    "description": "Custom MCP server",
    "code": "export function listTools() { return []; } export async function callTool(name, args) { return { content: [] }; }",
    "enabled": true
  }'
\`\`\`

### Get MCP Code

\`\`\`bash
curl http://localhost:8001/api/mcps/{name}
\`\`\`

---

## Common Integration Patterns

### Pattern 1: One-Shot Query

\`\`\`bash
curl -X POST http://localhost:8001/api/agent/chat \\
  -H "Content-Type: application/json" \\
  -d '{"domain": "main", "message": "What is the capital of France?"}'
\`\`\`

### Pattern 2: Multi-Turn Conversation

\`\`\`bash
# First message
RESPONSE=$(curl -X POST http://localhost:8001/api/agent/chat \\
  -H "Content-Type: application/json" \\
  -d '{"domain": "main", "message": "Tell me about MCP"}')

SESSION_ID=$(echo $RESPONSE | jq -r '.session_id')

# Follow-up message
curl -X POST http://localhost:8001/api/agent/chat \\
  -H "Content-Type: application/json" \\
  -d "{\"domain\": \"main\", \"message\": \"Can you explain more?\", \"session_id\": \"$SESSION_ID\"}"
\`\`\`

### Pattern 3: Tool Discovery & Direct Call

\`\`\`bash
# Discover tools
curl -X POST http://localhost:8001/mcp \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc": "2.0", "id": 1, "method": "tools/list"}'

# Call specific tool
curl -X POST http://localhost:8001/mcp \\
  -H "Content-Type: application/json" \\
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "name": "biz_db__sql",
      "arguments": {"query": "SELECT * FROM users LIMIT 10"}
    }
  }'
\`\`\`

### Pattern 4: Skill as Resource

\`\`\`bash
# List skills
curl -X POST http://localhost:8001/mcp \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc": "2.0", "id": 1, "method": "resources/list"}'

# Read skill content
curl -X POST http://localhost:8001/mcp \\
  -H "Content-Type: application/json" \\
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "resources/read",
    "params": {"uri": "skill://my-skill-name"}
  }'
\`\`\`

---

## Environment Variables

\`\`\`bash
PORT=8001                          # Main server port
DATABASE_URL=postgresql://...      # System database
BUSINESS_DATABASE_URL=postgresql://... # Business data
LLM_API_KEY=...                    # LLM provider key
LLM_BASE_URL=https://...           # LLM API endpoint
\`\`\`

See \`.env.example\` for complete list.

---

## Architecture Notes

### Service-First Design
- All business logic in \`src/lib/services/\`
- API routes and MCP providers call services
- Changes via REST API immediately visible to MCP tools

### Domain System
- Each domain has: systemPrompt, skills, mcpProviders, hooks
- Domains registered in \`src/lib/domains/registry.ts\`
- Agent behavior specialized per domain

### Tool Naming
- Full server: \`providerName__toolName\` (qualified)
- Scoped server: \`toolName\` (unqualified)
- Separator: \`__\` (double underscore)

### Protected Providers
- Core + catalog providers cannot be replaced/deleted
- Dynamic MCPs can be created/updated/deleted freely

---

## References

- **API Playbook**: \`docs/api-playbook.md\` - Complete API contract and time dependencies
- **MCP Proxy**: \`docs/mcp-proxy.md\` - Persistent connection proxy for service restarts
- **Skill Management**: \`docs/skill-management.md\` - Skill CRUD operations
- **Architecture**: \`AGENTS.md\` - System constraints and design principles
`;
  };

  const tabItems = [
    {
      key: "overview",
      label: "概览",
      children: (
        <div className="space-y-6">
          <Card>
            <Title level={3}>系统概述</Title>
            <Paragraph>
              Agent-Forge 是一个标准的 MCP (Model Context Protocol) 服务器，对外暴露：
            </Paragraph>
            <ul className="list-disc list-inside space-y-2">
              <li>所有内部工具作为 MCP tools</li>
              <li>通过 <Text code>agent__chat</Text> 工具提供 Agent 对话能力</li>
              <li>Skills 作为 MCP resources（<Text code>skill://</Text> URIs）</li>
              <li>领域专门化 agents（main, video）</li>
            </ul>
            <Paragraph className="mt-4">
              <Text strong>Base URL:</Text> <Text code>http://localhost:8001</Text>
            </Paragraph>
            <Paragraph>
              <Text strong>MCP Endpoint:</Text> <Text code>POST /mcp</Text>
            </Paragraph>
          </Card>

          <Card>
            <Title level={3}>快速开始</Title>
            <Title level={4}>1. 作为 MCP 客户端连接</Title>
            <pre className="bg-slate-900 p-4 rounded overflow-x-auto">
              <code>{`{
  "mcpServers": {
    "agent-forge": {
      "url": "http://localhost:8001/mcp"
    }
  }
}`}</code>
            </pre>

            <Title level={4} className="mt-6">2. 发现可用工具</Title>
            <pre className="bg-slate-900 p-4 rounded overflow-x-auto">
              <code>{`curl -X POST http://localhost:8001/mcp \\
  -H "Content-Type: application/json" \\
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list"
  }'`}</code>
            </pre>

            <Title level={4} className="mt-6">3. 调用 Agent Chat</Title>
            <pre className="bg-slate-900 p-4 rounded overflow-x-auto">
              <code>{`curl -X POST http://localhost:8001/mcp \\
  -H "Content-Type: application/json" \\
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "name": "agent__chat",
      "arguments": {
        "message": "Hello, what can you do?"
      }
    }
  }'`}</code>
            </pre>
          </Card>
        </div>
      ),
    },
    {
      key: "mcp",
      label: "MCP 端点",
      children: (
        <div className="space-y-6">
          <Card>
            <Title level={3}>完整服务器（所有工具）</Title>
            <Paragraph>
              <Text strong>端点:</Text> <Text code>POST /mcp</Text>
            </Paragraph>
            <Paragraph>
              <Text strong>工具:</Text> 所有 providers，限定名称（<Text code>provider__tool</Text>）
            </Paragraph>
            <Paragraph>
              <Text strong>资源:</Text> 所有 skills（<Text code>skill://skillName</Text>）
            </Paragraph>
            <Paragraph>
              <Text strong>特殊工具:</Text> <Text code>agent__chat</Text> 用于 agent 对话
            </Paragraph>
          </Card>

          <Card>
            <Title level={3}>作用域服务器（单个 Provider）</Title>
            <Paragraph>
              <Text strong>端点:</Text> <Text code>POST /mcp/{`{provider}`}</Text>
            </Paragraph>
            <Paragraph>
              <Text strong>工具:</Text> 仅单个 provider，非限定名称
            </Paragraph>
            <Paragraph>
              <Text strong>示例:</Text> <Text code>POST /mcp/biz_db</Text> 仅暴露 <Text code>biz_db</Text> 工具
            </Paragraph>
          </Card>

          <Card>
            <Title level={3}>发现与管理</Title>
            <Title level={4}>列出静态 Providers（内置）</Title>
            <pre className="bg-slate-900 p-4 rounded overflow-x-auto">
              <code>curl http://localhost:8001/api/mcps/builtins</code>
            </pre>
            <Paragraph className="mt-4">
              返回所有内置静态 providers：
            </Paragraph>
            <ul className="list-disc list-inside space-y-1">
              <li><Text code>agent_forge</Text>, <Text code>biz_db</Text>, <Text code>langfuse_admin</Text>, <Text code>langfuse</Text>, <Text code>multimodal</Text>, <Text code>oss</Text>, <Text code>skills</Text>, <Text code>subagent</Text>, <Text code>video_mgr</Text></li>
            </ul>
          </Card>
        </div>
      ),
    },
    {
      key: "agent",
      label: "Agent API",
      children: (
        <div className="space-y-6">
          <Card>
            <Title level={3}>统一入口（推荐）</Title>
            <pre className="bg-slate-900 p-4 rounded overflow-x-auto">
              <code>{`curl -X POST http://localhost:8001/api/agent/chat \\
  -H "Content-Type: application/json" \\
  -d '{
    "domain": "main",
    "message": "Your message here",
    "session_id": "optional-session-id",
    "user": "optional-username",
    "model": "optional-model-override",
    "skills": ["optional-skill-names"],
    "images": ["optional-image-urls"]
  }'`}</code>
            </pre>
            <Paragraph className="mt-4">
              <Text strong>响应:</Text>
            </Paragraph>
            <pre className="bg-slate-900 p-4 rounded overflow-x-auto">
              <code>{`{
  "session_id": "ses_...",
  "reply": "Agent's response"
}`}</code>
            </pre>
          </Card>

          <Card>
            <Title level={3}>可用 Domains</Title>
            <ul className="list-disc list-inside space-y-2">
              <li><Text code>main</Text> - 通用 agent</li>
              <li><Text code>video</Text> - 视频生成工作流 agent</li>
            </ul>
          </Card>

          <Card>
            <Title level={3}>会话管理</Title>
            <ul className="list-disc list-inside space-y-2">
              <li>首次请求：省略 <Text code>session_id</Text>，服务器创建新会话</li>
              <li>后续请求：包含 <Text code>session_id</Text> 以继续对话</li>
              <li>会话持久化在 DB，重启后保留</li>
            </ul>
          </Card>

          <Card>
            <Title level={3}>作为 Subagent 使用</Title>
            <Title level={4}>通过 MCP Tool（从另一个 agent）</Title>
            <pre className="bg-slate-900 p-4 rounded overflow-x-auto">
              <code>{`// 调用 agent__chat tool
const result = await callTool("agent__chat", {
  message: "Analyze this codebase structure",
  session_id: "optional-session-id"
});`}</code>
            </pre>

            <Title level={4} className="mt-6">通过 REST API（从外部系统）</Title>
            <pre className="bg-slate-900 p-4 rounded overflow-x-auto">
              <code>{`curl -X POST http://localhost:8001/api/agent/chat \\
  -H "Content-Type: application/json" \\
  -d '{
    "domain": "main",
    "message": "Your task here"
  }'`}</code>
            </pre>

            <Title level={4} className="mt-6">Domain 委派（跨 Domain 调用）</Title>
            <pre className="bg-slate-900 p-4 rounded overflow-x-auto">
              <code>{`// 通过 agent__agent_delegate tool
const result = await callTool("agent__agent_delegate", {
  domain: "video",
  message: "Generate video script",
  context: { novelId: "123" }
});`}</code>
            </pre>
          </Card>
        </div>
      ),
    },
    {
      key: "patterns",
      label: "集成模式",
      children: (
        <div className="space-y-6">
          <Card>
            <Title level={3}>模式 1: 单次查询</Title>
            <pre className="bg-slate-900 p-4 rounded overflow-x-auto">
              <code>{`curl -X POST http://localhost:8001/api/agent/chat \\
  -H "Content-Type: application/json" \\
  -d '{"domain": "main", "message": "What is the capital of France?"}'`}</code>
            </pre>
          </Card>

          <Card>
            <Title level={3}>模式 2: 多轮对话</Title>
            <pre className="bg-slate-900 p-4 rounded overflow-x-auto">
              <code>{`# 首次消息
RESPONSE=$(curl -X POST http://localhost:8001/api/agent/chat \\
  -H "Content-Type: application/json" \\
  -d '{"domain": "main", "message": "Tell me about MCP"}')

SESSION_ID=$(echo $RESPONSE | jq -r '.session_id')

# 后续消息
curl -X POST http://localhost:8001/api/agent/chat \\
  -H "Content-Type: application/json" \\
  -d "{\\"domain\\": \\"main\\", \\"message\\": \\"Can you explain more?\\", \\"session_id\\": \\"$SESSION_ID\\"}"`}</code>
            </pre>
          </Card>

          <Card>
            <Title level={3}>模式 3: 工具发现与直接调用</Title>
            <pre className="bg-slate-900 p-4 rounded overflow-x-auto">
              <code>{`# 发现工具
curl -X POST http://localhost:8001/mcp \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc": "2.0", "id": 1, "method": "tools/list"}'

# 调用特定工具
curl -X POST http://localhost:8001/mcp \\
  -H "Content-Type: application/json" \\
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "name": "biz_db__sql",
      "arguments": {"query": "SELECT * FROM users LIMIT 10"}
    }
  }'`}</code>
            </pre>
          </Card>

          <Card>
            <Title level={3}>模式 4: Skill 作为资源</Title>
            <pre className="bg-slate-900 p-4 rounded overflow-x-auto">
              <code>{`# 列出 skills
curl -X POST http://localhost:8001/mcp \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc": "2.0", "id": 1, "method": "resources/list"}'

# 读取 skill 内容
curl -X POST http://localhost:8001/mcp \\
  -H "Content-Type: application/json" \\
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "resources/read",
    "params": {"uri": "skill://my-skill-name"}
  }'`}</code>
            </pre>
          </Card>
        </div>
      ),
    },
    {
      key: "reference",
      label: "参考文档",
      children: (
        <div className="space-y-6">
          <Card>
            <Title level={3}>环境变量</Title>
            <pre className="bg-slate-900 p-4 rounded overflow-x-auto">
              <code>{`PORT=8001                          # 主服务器端口
DATABASE_URL=postgresql://...      # 系统数据库
BUSINESS_DATABASE_URL=postgresql://... # 业务数据
LLM_API_KEY=...                    # LLM provider key
LLM_BASE_URL=https://...           # LLM API endpoint`}</code>
            </pre>
            <Paragraph className="mt-4">
              完整列表见 <Text code>.env.example</Text>
            </Paragraph>
          </Card>

          <Card>
            <Title level={3}>架构说明</Title>
            <Title level={4}>Service-First 设计</Title>
            <ul className="list-disc list-inside space-y-2">
              <li>所有业务逻辑在 <Text code>src/lib/services/</Text></li>
              <li>API routes 和 MCP providers 调用 services</li>
              <li>通过 REST API 的变更立即对 MCP tools 可见</li>
            </ul>

            <Title level={4} className="mt-4">Domain 系统</Title>
            <ul className="list-disc list-inside space-y-2">
              <li>每个 domain 有：systemPrompt, skills, mcpProviders, hooks</li>
              <li>Domains 注册在 <Text code>src/lib/domains/registry.ts</Text></li>
              <li>Agent 行为按 domain 专门化</li>
            </ul>

            <Title level={4} className="mt-4">工具命名</Title>
            <ul className="list-disc list-inside space-y-2">
              <li>完整服务器：<Text code>providerName__toolName</Text>（限定）</li>
              <li>作用域服务器：<Text code>toolName</Text>（非限定）</li>
              <li>分隔符：<Text code>__</Text>（双下划线）</li>
            </ul>

            <Title level={4} className="mt-4">受保护的 Providers</Title>
            <Paragraph>
              Core + catalog providers 不能被替换/删除
            </Paragraph>
          </Card>

          <Card>
            <Title level={3}>相关文档</Title>
            <ul className="list-disc list-inside space-y-2">
              <li><Text strong>API Playbook:</Text> <Text code>docs/api-playbook.md</Text> - 完整 API 契约和时序依赖</li>
              <li><Text strong>MCP Proxy:</Text> <Text code>docs/mcp-proxy.md</Text> - 服务重启时的持久连接代理</li>
              <li><Text strong>Skill Management:</Text> <Text code>docs/skill-management.md</Text> - Skill CRUD 操作</li>
              <li><Text strong>Architecture:</Text> <Text code>AGENTS.md</Text> - 系统约束和设计原则</li>
            </ul>
          </Card>
        </div>
      ),
    },
  ];

  return (
    <ConfigProvider
      theme={{
        algorithm: antTheme.darkAlgorithm,
      }}
    >
      <div className="min-h-screen bg-slate-950 text-slate-100 p-8">
        <div className="max-w-6xl mx-auto">
          <div className="flex justify-between items-center mb-8">
            <div>
              <Title level={1} className="!text-slate-100 !mb-2">
                Agent-Forge 集成指南
              </Title>
              <Paragraph className="text-slate-400">
                外部系统对接 Agent-Forge 的完整指南
              </Paragraph>
            </div>
            <Button
              type="primary"
              icon={copied ? <CheckOutlined /> : <CopyOutlined />}
              onClick={handleCopyMarkdown}
              size="large"
            >
              {copied ? "已复制" : "复制为 Markdown"}
            </Button>
          </div>

          <Tabs
            activeKey={activeTab}
            onChange={setActiveTab}
            items={tabItems}
            size="large"
          />
        </div>
      </div>
    </ConfigProvider>
  );
}
