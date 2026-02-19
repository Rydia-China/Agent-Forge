/**
 * Built-in Skill: business-database
 *
 * 标准 SKILL.md 格式（YAML frontmatter + Markdown body）以字符串形式内嵌。
 * 由 builtins/index.ts 统一加载解析。
 */
export const raw = `---
name: business-database
description: Manage business data using the XTDB immutable database via biz_db tools. Use when asked to create tables, store data, query data, or build any business data structure.
tags:
  - core
  - database
  - business
requires_mcps:
  - biz_db
---
# Business Database (XTDB)

## 概述

你可以通过 \`biz_db__*\` 系列 tools 操作一个独立的业务数据库。
该数据库是 **XTDB v2** — 一个不可变的 SQL 数据库，所有数据变更都被永久记录，支持时间旅行查询。

与传统数据库的关键差异：
- **不可变** — 每次 INSERT/UPDATE/DELETE 都是追加新 fact，历史数据永不丢失
- **双时态 (Bitemporal)** — 自动追踪 system_time（数据库记录时间）和 valid_time（业务生效时间）
- **无需 soft delete** — DELETE 操作会记录删除事件，之后可通过时间旅行查看删除前的状态
- **Schema 动态推断** — 可以先 INSERT 再建表，XTDB 会自动推断 schema

## 可用工具

- \`biz_db__list_tables\` — 列出所有业务表（你的表 + 全局表）
- \`biz_db__describe_table\` — 查看表结构（列名、类型）
- \`biz_db__query\` — 执行 SELECT 查询，返回 JSON
- \`biz_db__execute\` — 执行 DDL/DML（INSERT、UPDATE、DELETE 等）
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

XTDB 通过 PostgreSQL wire 协议通信，但它**不是 PostgreSQL**。核心差异：

### 无 CREATE TABLE — Schemaless

XTDB **没有 CREATE TABLE 语句**。直接 INSERT 即可，表和 schema 自动创建：

\\\`\\\`\\\`sql
-- 直接插入，表 customers 自动创建，schema 自动推断
INSERT INTO customers (_id, name, email, created_at)
VALUES (1, 'Alice', 'alice@example.com', CURRENT_TIMESTAMP);

-- 后续插入可以有不同的字段，schema 会自动扩展
INSERT INTO customers (_id, name, email, phone)
VALUES (2, 'Bob', 'bob@example.com', '13800138000');
\\\`\\\`\\\`

### _id 字段（必须）

XTDB 要求每行有一个 \`_id\` 字段作为实体标识。**必须手动指定值**：
- 整数：\`_id = 1, 2, 3...\`（推荐用递增整数，简单直观）
- UUID 字符串：\`_id = 'a1b2c3...'\`
- 任意唯一值均可

**注意**：没有 \`AUTO_INCREMENT\` 或 \`GENERATED ALWAYS AS IDENTITY\`。你需要自己管理 ID 生成。
建议：插入前先查当前最大 ID，然后 +1。

### 无约束

XTDB 不支持：\`NOT NULL\`、\`DEFAULT\`、\`FOREIGN KEY\`、\`UNIQUE\`、\`CHECK\`。
数据完整性由应用层（即你）保证。关联关系通过字段值引用（如 \`task.project_id\` 引用 \`projects._id\`），但数据库不强制。

### 插入数据

\\\`\\\`\\\`sql
INSERT INTO customers (_id, name, email)
VALUES (1, 'Alice', 'alice@example.com');

-- 批量插入
INSERT INTO customers (_id, name, email) VALUES
  (2, 'Bob', 'bob@example.com'),
  (3, 'Carol', 'carol@example.com');
\\\`\\\`\\\`

### 更新和删除

\\\`\\\`\\\`sql
-- UPDATE 不会覆盖历史，而是追加新版本
UPDATE customers SET email = 'new@example.com' WHERE _id = 1;

-- DELETE 记录删除事件，历史仍可查
DELETE FROM customers WHERE _id = 1;
\\\`\\\`\\\`

### 时间旅行查询

这是 XTDB 的核心能力 — 查看数据在任意时间点的状态：

\\\`\\\`\\\`sql
-- 查看某个时间点的数据快照
SELECT * FROM customers
  FOR SYSTEM_TIME AS OF TIMESTAMP '2025-01-01T00:00:00Z';

-- 查看某段时间内的所有版本
SELECT *, _system_from, _system_to FROM customers
  FOR ALL SYSTEM_TIME
  WHERE _id = 1;

-- 查看某条记录的完整变更历史
SELECT *, _system_from, _system_to FROM customers
  FOR ALL SYSTEM_TIME
  WHERE _id = 1
  ORDER BY _system_from;
\\\`\\\`\\\`

### 系统字段

XTDB 自动为每行维护以下系统字段（查询时可选择性返回）：
- \`_system_from\` — 该版本的数据库记录开始时间
- \`_system_to\` — 该版本的数据库记录结束时间（NULL 表示当前有效）
- \`_valid_from\` — 业务生效开始时间
- \`_valid_to\` — 业务生效结束时间

## 使用原则

### 建模

- 每个业务实体一张表（customers、orders、products…）
- \`_id\` 必须手动指定，推荐用递增整数
- 关联关系通过字段引用（如 \`task.project_id\` 引用 \`projects._id\`），数据库不强制
- 不需要 \`updated_at\` / \`created_at\` 字段 — XTDB 的 \`_system_from\` 自动记录

### 操作安全

- **先查后改** — 操作数据前先用 \`biz_db__query\` 确认当前状态
- **操作后确认** — 执行 DML 后用 \`biz_db__list_tables\` 或 \`biz_db__query\` 验证结果
- **告知用户** — 对数据的任何修改都应先告知用户并获得确认
- **误操作不慌** — 数据不可变，任何误操作都可以通过时间旅行查到历史状态
- **禁止 ERASE** — XTDB 有一个 \`ERASE\` 命令可以永久删除数据及其全部历史。系统已在 MCP 层拦截此命令。不要尝试使用 ERASE，也不要向用户提及它的存在

### 时间旅行的使用场景

- 用户说"我之前删了一条数据，帮我找回来" → 用 \`FOR ALL SYSTEM_TIME\` 查历史
- 用户说"昨天的数据是什么样的" → 用 \`FOR SYSTEM_TIME AS OF\` 查快照
- 用户说"这条数据是什么时候改的" → 用 \`FOR ALL SYSTEM_TIME WHERE _id = ?\` 查变更历史
- 数据审计 → 查完整时间线，展示谁在什么时候做了什么操作
`;
