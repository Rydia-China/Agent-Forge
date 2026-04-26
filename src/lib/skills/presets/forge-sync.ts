/**
 * Built-in Skill: forge-sync
 *
 * 标准 SKILL.md 格式（YAML frontmatter + Markdown body）以字符串形式内嵌。
 * 由 builtins/index.ts 统一加载解析。
 */
export const raw = `---
name: forge-sync
description: Sync skills and MCPs between local and remote hubs. Use when you need capabilities not available locally, or want to share local skills/MCPs to the hub.
tags:
  - meta
  - core
requires_mcps: []
---
# Forge Sync

## 概述

本系统采用 Hub-Spoke 架构同步 Skills 和 MCPs：
- **Hub** — 中心仓库（默认 \`https://agent.mob-ai.cn/\`），存储共享的 skills 和 MCPs
- **Spoke** — 本地实例，从 hub 拉取所需能力，也可以将本地成果推送到 hub

所有 sync 操作通过 \`sync\` MCP 的工具完成。

## 何时使用

### 需要 Pull 的场景
- 用户提到一个你没有的 skill 或 MCP
- 开始一个新领域的任务，不确定 hub 上是否有相关工具
- 用户明确要求从 hub 同步

### 需要 Push 的场景
- 完善了一个 skill 或 MCP，用户希望分享到 hub
- 用户明确要求推送到 hub

## 标准流程：diff → pull → merge → push

Sync 是严谨操作，每个资源逐个决策，完整闭环如下：

### 1. Diff — 了解差异

调用 \`sync__diff\` 查看本地与远程的差异：
- 返回每个资源的状态：\`local_only\`、\`remote_only\`、\`both\`

### 2. Pull — 先拉到本地

对需要同步的资源，**先 pull**（\`sync__pull\`）：
- \`remote_only\` → 本地没有，pull 会创建新本地资源 (v1)
- \`both\` → 本地已有，pull 会创建新本地版本 (latest + 1)，旧版本保留可 revert

**Pull 总是安全的**：不会覆盖，只追加版本。

### 3. Merge — 在本地合并

Pull 后，对比本地旧版本和 pull 下来的新版本，决定最终内容：
- **Skill**: 用 \`skills__get\` 读取 pull 后的内容，结合本地修改，用 \`skills__update\` 创建合并版本
- **MCP**: 用 \`mcp_manager__get_code\` 读取 pull 后的代码，结合本地修改，用 \`mcp_manager__update_code\` 或 \`mcp_manager__patch_code\` 创建合并版本
- 如果 pull 的内容直接可用（无需修改），跳过此步

Merge 也是一个新版本，历史完整可回溯。

### 4. Push — 推送合并结果到 hub

合并完成后，调用 \`sync__push\` 将最终版本推送到 hub：
- 远程会创建新版本，不会覆盖远程历史
- 至此完成一次完整的同步闭环

### 发现（可选）

如果不确定 hub 上有什么，先调用 \`sync__discover\` 浏览：
- \`type="skill"\` 查看 skills，\`type="mcp"\` 查看 MCPs
- 可选 \`tag\` 过滤（仅 skills）

## 工具一览

| 工具 | 用途 |
|------|------|
| \`sync__discover\` | 查看远程 hub 上可用的 skills/MCPs |
| \`sync__diff\` | 对比本地与远程的差异（同步前必做） |
| \`sync__pull\` | 从远程拉取单个 skill/MCP（创建新本地版本） |
| \`sync__push\` | 推送合并后的 skill/MCP 到远程 |

## 注意事项

- **同步前必须先 diff**，不要盲目操作
- **先 pull 再 merge**，不要直接用 push 覆盖远程
- 每个资源逐个决策，不做批量操作
- 所有操作都是版本追加，历史完整可 revert
- Hub 实例不能 sync 自己（系统会自动拒绝）
`;
