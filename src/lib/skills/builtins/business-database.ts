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
这是一个标准的 PostgreSQL 16 实例，支持完整的 DDL/DML 和所有 PG 特性。

## 可用工具

- \`biz_db__list_tables\` — 列出所有业务表（你的表 + 全局表）
- \`biz_db__describe_table\` — 查看表结构（列名、类型、是否可空）
- \`biz_db__query\` — 执行 SELECT 查询，返回 JSON
- \`biz_db__execute\` — 执行 DDL/DML（CREATE TABLE、INSERT、UPDATE、DELETE 等）
- \`biz_db__upgrade_global\` — 将你的表升级为全局表（不可逆）
- \`biz_db__list_global_tables\` — 列出全局表

## 数据隔离

业务数据库按用户自动隔离。你写的 SQL 中使用逻辑表名，系统会自动映射到物理存储，**你无需关心底层细节**：

- 你创建的表只有你能看到，其他用户看不到
- \`biz_db__list_tables\` 会显示你的表和全局表，scope 字段区分
- 查询时优先匹配你的表，找不到再查全局表
- 如需让所有用户都能访问，使用 \`biz_db__upgrade_global\` 升级为全局表
- 全局升级**不可逆**。如果表之间有关联，系统会提示一并升级

## SQL 语法

标准 PostgreSQL SQL。以下是常用模式：

### 建表

必须先用 CREATE TABLE 创建表结构，再插入数据：

\\\`\\\`\\\`sql
CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
\\\`\\\`\\\`

### 主键

所有表统一使用 UUID 主键：\`id UUID PRIMARY KEY DEFAULT gen_random_uuid()\`。
数据库自动生成，INSERT 时无需传入 id。

### 数据类型

常用类型：
- 文本：\`TEXT\`, \`VARCHAR(n)\`
- 数值：\`INTEGER\`, \`BIGINT\`, \`NUMERIC(p,s)\`, \`REAL\`, \`DOUBLE PRECISION\`
- 布尔：\`BOOLEAN\`
- 时间：\`TIMESTAMPTZ\`, \`DATE\`, \`TIME\`
- JSON：\`JSONB\`（推荐）, \`JSON\`
- 数组：\`TEXT[]\`, \`INTEGER[]\` 等

### 约束

支持的列约束：
- \`NOT NULL\` — 非空
- \`UNIQUE\` — 唯一
- \`PRIMARY KEY\` — 主键
- \`CHECK (expr)\` — 检查约束
- \`DEFAULT value\` — 默认值

**不支持**（受表名隔离机制限制）：
- \`REFERENCES\` 外键 — 关联关系通过字段值约定（如 \`order.customer_id\` 存储 \`customers.id\` 的 UUID），应用层保证
- \`CREATE INDEX\` — 索引由系统自动管理，无需手动创建

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

### 修改表结构

\\\`\\\`\\\`sql
-- 添加列
ALTER TABLE customers ADD COLUMN address TEXT;

-- 删除列
ALTER TABLE customers DROP COLUMN phone;
\\\`\\\`\\\`

## 使用原则

### 建模

- 每个业务实体一张表（customers、orders、products…）
- 主键统一用 \`id UUID PRIMARY KEY DEFAULT gen_random_uuid()\`
- 关联关系通过字段值约定（如 \`order.customer_id\` 存储关联表的 UUID），应用层保证完整性
- 时间字段用 \`TIMESTAMPTZ\`，统一带时区
- 需要审计时间的表加 \`created_at TIMESTAMPTZ DEFAULT NOW()\` 和 \`updated_at TIMESTAMPTZ DEFAULT NOW()\`

### 操作安全

- **先查后改** — 操作数据前先用 \`biz_db__query\` 确认当前状态
- **操作后确认** — 执行 DDL/DML 后用 \`biz_db__describe_table\` 或 \`biz_db__query\` 验证结果
- **告知用户** — 对数据的任何修改都应先告知用户并获得确认
- **DDL 谨慎** — DROP TABLE、DROP COLUMN 等操作不可逆，务必先确认
- **事务安全** — 单条 SQL 自动在事务中执行，无需手动 BEGIN/COMMIT
`;
