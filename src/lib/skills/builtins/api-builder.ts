/**
 * Built-in Skill: api-builder
 *
 * 标准 SKILL.md 格式（YAML frontmatter + Markdown body）以字符串形式内嵌。
 * 由 builtins/index.ts 统一加载解析。
 */
export const raw = `---
name: api-builder
description: Create APIs that expose business database operations as versioned, documentated endpoints for third-party access. Use when asked to build CRUD interfaces, data APIs, or public endpoints.
tags:
  - core
  - api
  - database
requires_mcps:
  - apis
  - biz_db
---
# API Builder

## 概述

API 是系统的一等公民，与 Skill 和 MCP 平级。API 把对业务 PostgreSQL 数据库的 SQL 操作声明式持久化，形成可管理、可版本化、可对外提供的 CRUD 接口。

API **不是** MCP，不涉及沙箱或代码执行。API 是纯数据：
- \`schema\` — 描述管理哪些表、哪些字段
- \`operations\` — 声明式 SQL 操作（参数化查询）

系统直接执行参数化 SQL，通过 sql-guard 保障安全。

## 创建流程

### 1. 设计数据模型

根据用户需求确定表结构。业务数据库是标准 PostgreSQL：
- 必须先 \`CREATE TABLE\` 定义表结构
- 主键统一用 \`id UUID PRIMARY KEY DEFAULT gen_random_uuid()\`
- 充分使用约束：\`NOT NULL\`、\`UNIQUE\`、\`REFERENCES\`

### 2. 建立表结构

用 \`biz_db__execute\` 创建表：

\\\`\\\`\\\`sql
CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
\\\`\\\`\\\`

### 3. 设计 operations

每个 operation 是一条参数化 SQL。结构：

\\\`\\\`\\\`json
{
  "name": "operation_name",
  "description": "What this operation does",
  "type": "query",
  "sql": "SELECT * FROM customers WHERE id = $1",
  "params": ["id"],
  "input": {
    "id": { "type": "string", "required": true, "description": "Customer UUID" }
  }
}
\\\`\\\`\\\`

**字段说明**：
- \`type\` — \`"query"\`（SELECT/WITH）或 \`"execute"\`（INSERT/UPDATE/DELETE）
- \`sql\` — 参数化 SQL，使用 \`$1\`, \`$2\` 等占位符
- \`params\` — 参数名数组，顺序对应 \`$1\`, \`$2\`...
- \`input\` — 每个参数的类型、是否必填、描述

### 4. 调用 apis__create

\\\`\\\`\\\`json
{
  "name": "customer-api",
  "description": "Customer management CRUD API",
  "schema": {
    "tables": {
      "customers": {
        "id": "uuid",
        "name": "text",
        "email": "text",
        "phone": "text",
        "created_at": "timestamptz"
      }
    }
  },
  "operations": [
    {
      "name": "list",
      "description": "List all customers",
      "type": "query",
      "sql": "SELECT * FROM customers ORDER BY id",
      "params": [],
      "input": {}
    },
    {
      "name": "get",
      "description": "Get customer by ID",
      "type": "query",
      "sql": "SELECT * FROM customers WHERE id = $1",
      "params": ["id"],
      "input": {
        "id": { "type": "string", "required": true, "description": "Customer UUID" }
      }
    },
    {
      "name": "create",
      "description": "Create a new customer",
      "type": "execute",
      "sql": "INSERT INTO customers (name, email, phone) VALUES ($1, $2, $3) RETURNING id",
      "params": ["name", "email", "phone"],
      "input": {
        "name": { "type": "string", "required": true, "description": "Customer name" },
        "email": { "type": "string", "required": true, "description": "Email address" },
        "phone": { "type": "string", "required": false, "description": "Phone number" }
      }
    },
    {
      "name": "update",
      "description": "Update customer info",
      "type": "execute",
      "sql": "UPDATE customers SET name = $1, email = $2, phone = $3 WHERE id = $4",
      "params": ["name", "email", "phone", "id"],
      "input": {
        "name": { "type": "string", "required": true },
        "email": { "type": "string", "required": true },
        "phone": { "type": "string", "required": false },
        "id": { "type": "string", "required": true, "description": "Customer UUID to update" }
      }
    },
    {
      "name": "delete",
      "description": "Delete a customer",
      "type": "execute",
      "sql": "DELETE FROM customers WHERE id = $1",
      "params": ["id"],
      "input": {
        "id": { "type": "string", "required": true, "description": "Customer UUID to delete" }
      }
    }
  ]
}
\\\`\\\`\\\`

### 5. 测试

通过 \`apis__call\` 逐个测试操作：

\\\`\\\`\\\`json
{ "api_name": "customer-api", "operation": "create", "params": { "name": "Alice", "email": "alice@example.com", "phone": "13800138000" } }
{ "api_name": "customer-api", "operation": "list" }
{ "api_name": "customer-api", "operation": "get", "params": { "id": "<uuid from create>" } }
\\\`\\\`\\\`

## 第三方接入

创建的 API 自动获得两种接入方式：

### MCP 接入
第三方 MCP client 通过 \`/mcp\` 端点使用 \`apis__call\` tool。

### HTTP REST 接入
- **文档**：\`GET /api/public/{api-name}\` — 返回 JSON 格式的 API 文档
- **调用**：\`POST /api/public/{api-name}/{operation}\` — JSON body 传参数

示例：
\\\`\\\`\\\`bash
# 查看 API 文档
curl http://localhost:8001/api/public/customer-api

# 创建客户
curl -X POST http://localhost:8001/api/public/customer-api/create \\
  -H 'Content-Type: application/json' \\
  -d '{"name": "Alice", "email": "alice@example.com"}'

# 查询客户列表
curl -X POST http://localhost:8001/api/public/customer-api/list
\\\`\\\`\\\`

## 数据隔离与表名

API 中的 SQL 表名会根据当前用户自动处理：
- 通过 Agent 对话调用 API 时，SQL 中的表名自动映射到当前用户的表（或全局表）
- 通过 HTTP 公开端点（\`/api/public/...\`）调用时，无用户上下文，SQL 直接操作裸表名（仅全局表可用）
- 如果 API 需要通过 HTTP 公开给第三方使用，确保相关表已通过 \`biz_db__upgrade_global\` 升级为全局表

## SQL 注意事项

### 参数化
所有 SQL 必须使用 \`$1\`, \`$2\` 参数占位符，**禁止字符串拼接**。系统通过 PostgreSQL 参数化查询执行，无注入风险。

### 主键
所有表统一使用 \`id UUID PRIMARY KEY DEFAULT gen_random_uuid()\`。INSERT 时无需传 id，数据库自动生成。用 \`RETURNING id\` 获取生成的 UUID。

### SQL Guard 限制
- \`type: "query"\` 只允许 SELECT / WITH 开头
- \`type: "execute"\` 允许 INSERT / UPDATE / DELETE / CREATE / ALTER / DROP / TRUNCATE
- 禁止系统表访问、多语句、DROP DATABASE / DROP SCHEMA 等危险操作

### 时间戳
使用 \`NOW()\` 或 \`CURRENT_TIMESTAMP\` 由数据库生成，不需要客户端传入。建表时用 \`DEFAULT NOW()\` 自动填充。

## 版本管理

API 支持版本管理，与 Skill 和 MCP 相同模式：
- \`apis__update\` — 推新版本（自动提升为 production）
- \`apis__list_versions\` — 查看版本历史
- \`apis__set_production\` — 回滚到指定版本
- \`apis__toggle\` — 启用/禁用 API

## 命名约定

- API 名称使用 kebab-case（如 \`customer-api\`、\`order-api\`）
- Operation 名称使用 snake_case（如 \`list_customers\`、\`create_order\`）
- 避免与已有 McpServer 同名

## 可用工具

| 操作 | 工具 |
|------|------|
| 列出所有 API | \`apis__list\` |
| 查看 API 详情 | \`apis__get\` |
| 调用 API 操作 | \`apis__call\` |
| 创建 API | \`apis__create\` |
| 更新 API | \`apis__update\` |
| 删除 API | \`apis__delete\` |
| 启用/禁用 | \`apis__toggle\` |
| 查看版本 | \`apis__list_versions\` |
| 设置 production | \`apis__set_production\` |
`;
