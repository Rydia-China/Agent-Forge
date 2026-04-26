/**
 * Built-in Skill: business-database
 *
 * 标准 SKILL.md 格式（YAML frontmatter + Markdown body）以字符串形式内嵌。
 * 由 builtins/index.ts 统一加载解析。
 */
export const raw = `---
name: business-database
description: Manage business data using the PostgreSQL business database via biz_db tools. Use when asked to create tables, store data, query data, or build any business data structure.
tags:
  - core
  - database
  - business
requires_mcps:
  - biz_db
---
# Business Database (PostgreSQL)

## 概述

你可以通过 \`biz_db__*\` 系列 tools 操作一个独立的业务 PostgreSQL 数据库。
这是一个标准的 PostgreSQL 16 实例，支持完整的 SQL 特性。

**重要：DDL（表结构变更）和 DML（数据操作）是分离的。**
- 建表/改表/删表 → 使用声明式 schema tools（\`create_table\` / \`alter_table\` / \`drop_table\`）
- 数据读写 → 使用 \`sql\` tool（仅 SELECT/INSERT/UPDATE/DELETE/TRUNCATE）

## 可用工具

### Schema 管理（DDL）
- \`biz_db__create_table\` — 声明式创建表（结构化 columns + constraints 输入，自动版本化）
- \`biz_db__alter_table\` — 声明式修改表（add_column / drop_column / alter_column / add_constraint）
- \`biz_db__drop_table\` — 删除表及其 schema 注册
- \`biz_db__get_schema\` — 查看表的声明式 schema（列、约束、版本）
- \`biz_db__diff_schema\` — 对比声明 schema vs 物理表结构（漂移检测）
- \`biz_db__list_schemas\` — 列出所有已注册 schema 摘要
- \`biz_db__ensure_schema\` — 确保物理表存在（迁移/环境初始化用）

### 数据操作（DML）
- \`biz_db__sql\` — 执行 DML SQL。读（SELECT/WITH）返回 JSON 行，写（INSERT/UPDATE/DELETE/TRUNCATE）返回影响行数

### 表管理
- \`biz_db__list_tables\` — 列出所有业务表（你的表 + 全局表）
- \`biz_db__describe_table\` — 查看物理表结构（列名、类型、是否可空）
- \`biz_db__upgrade_global\` — 将你的表升级为全局表（不可逆）
- \`biz_db__list_global_tables\` — 列出全局表

## 数据隔离

业务数据库按用户自动隔离。你写的 SQL 中使用逻辑表名，系统会自动映射到物理存储，**你无需关心底层细节**：

- 你创建的表只有你能看到，其他用户看不到
- \`biz_db__list_tables\` 会显示你的表和全局表，scope 字段区分
- 查询时优先匹配你的表，找不到再查全局表
- 如需让所有用户都能访问，使用 \`biz_db__upgrade_global\` 升级为全局表
- 全局升级**不可逆**。如果表之间有关联，系统会提示一并升级

## 建表（Schema 声明）

**禁止**在 \`biz_db__sql\` 中使用 CREATE TABLE / ALTER TABLE / DROP TABLE。必须使用声明式 schema tools。

### 创建表

使用 \`biz_db__create_table\`，传入结构化定义：

\\\`\\\`\\\`json
{
  "tableName": "customers",
  "columns": [
    { "name": "id", "type": "uuid", "nullable": false, "default": "gen_random_uuid()" },
    { "name": "name", "type": "text", "nullable": false },
    { "name": "email", "type": "text", "nullable": false },
    { "name": "phone", "type": "text" },
    { "name": "created_at", "type": "timestamptz", "nullable": false, "default": "NOW()" }
  ],
  "constraints": [
    { "type": "pk", "columns": ["id"] },
    { "type": "unique", "columns": ["email"] }
  ],
  "description": "Customer master data"
}
\\\`\\\`\\\`

系统会：
1. 注册 schema v1（版本化，可追溯）
2. 生成 CREATE TABLE DDL 并执行
3. 自动创建表名映射（用户隔离）

### 修改表结构

使用 \`biz_db__alter_table\`，传入变更操作数组：

\\\`\\\`\\\`json
{
  "tableName": "customers",
  "actions": [
    { "action": "add_column", "column": { "name": "address", "type": "text" } },
    { "action": "drop_column", "name": "phone" },
    { "action": "alter_column", "name": "email", "nullable": false }
  ],
  "description": "Add address, remove phone"
}
\\\`\\\`\\\`

系统会自动 bump schema 版本并执行 ALTER TABLE DDL。

### 主键

所有表统一使用 UUID 主键：
\\\`\\\`\\\`json
{ "name": "id", "type": "uuid", "nullable": false, "default": "gen_random_uuid()" }
\\\`\\\`\\\`
加上 constraint: \`{ "type": "pk", "columns": ["id"] }\`。
INSERT 时无需传 id，数据库自动生成。

### 数据类型

常用类型（传入 columns 的 type 字段）：
- 文本：\`text\`, \`varchar(n)\`
- 数值：\`integer\`, \`bigint\`, \`numeric(p,s)\`, \`real\`, \`double precision\`
- 布尔：\`boolean\`
- 时间：\`timestamptz\`, \`date\`, \`time\`
- JSON：\`jsonb\`（推荐）, \`json\`
- 数组：\`text[]\`, \`integer[]\` 等
- UUID：\`uuid\`

### 约束

通过 constraints 数组定义：
- \`{ "type": "pk", "columns": ["id"] }\` — 主键
- \`{ "type": "unique", "columns": ["email"] }\` — 唯一约束

列级约束通过 column 定义：
- \`nullable: false\` — NOT NULL
- \`default: "expression"\` — 默认值

**不支持**（受表名隔离机制限制）：
- 外键 — 关联关系通过字段值约定（如 \`order.customer_id\` 存储 \`customers.id\` 的 UUID），应用层保证

## DML 语法

通过 \`biz_db__sql\` 执行标准 PostgreSQL DML：

### 插入数据

\\\`\\\`\\\`sql
-- 单条插入，id 自动生成 UUID
INSERT INTO customers (name, email)
VALUES ('Alice', 'alice@example.com');

-- 批量插入
INSERT INTO customers (name, email) VALUES
  ('Bob', 'bob@example.com'),
  ('Carol', 'carol@example.com');

-- 插入并返回生成的 id
INSERT INTO customers (name, email)
VALUES ('Dave', 'dave@example.com')
RETURNING id;
\\\`\\\`\\\`

### 更新和删除

\\\`\\\`\\\`sql
UPDATE customers SET email = 'new@example.com' WHERE id = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
DELETE FROM customers WHERE id = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
\\\`\\\`\\\`

## 使用原则

### 建模

- 每个业务实体一张表（customers、orders、products…）
- 主键统一用 UUID + gen_random_uuid()
- 关联关系通过字段值约定（如 \`order.customer_id\` 存储关联表的 UUID），应用层保证完整性
- 时间字段用 \`timestamptz\`，统一带时区
- 需要审计时间的表加 \`created_at\` 和 \`updated_at\`，default 为 \`NOW()\`

### 操作安全

- **先查后改** — 操作数据前先用 \`biz_db__sql\` SELECT 确认当前状态
- **操作后确认** — 执行后用 \`biz_db__describe_table\` 或 \`biz_db__get_schema\` 验证结果
- **告知用户** — 对数据/结构的任何修改都应先告知用户并获得确认
- **drop 谨慎** — \`drop_table\` 和 \`drop_column\` 不可逆，务必先确认
- **事务安全** — 单条 SQL 自动在事务中执行，无需手动 BEGIN/COMMIT
- **Schema 版本** — 每次 alter_table 都会创建新版本快照，可通过 \`get_schema\` 查看当前结构
`;
