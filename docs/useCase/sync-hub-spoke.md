# Use Case: Hub-Spoke Sync（Skills & MCPs 同步）

## 场景
本地 Spoke 实例通过 REST API 和 MCP tools 与远程 Hub 同步 Skills 和 MCPs。
验证 discover → diff → pull 完整链路，以及 push（仅 MCP tool）。

## 前置条件
- Hub 已部署并可访问（默认 `https://agent.mob-ai.cn/`）
- Hub 上至少存在 1 个 skill（内置的 `skill-creator` / `dynamic-mcp-builder` / `forge-sync`）
- Hub 上 `.env` 中 `FORGE_IS_HUB=true`（启用自同步保护）

## 验证步骤

> 以下用 `$HUB` 代表 hub 地址（如 `https://agent.mob-ai.cn`），`$SPOKE` 代表本地地址（如 `http://localhost:8001`）。
> 测试 REST API 时用 curl；测试 MCP tools 时通过 chat 间接调用。

### 1. Discover — 浏览 Hub 上可用资源

**REST API:**
```bash
curl -s -X POST $HUB/api/sync/discover \
  -H 'Content-Type: application/json' \
  -d '{"type":"skill"}'
```
期望：返回 JSON 数组，每个元素包含 `name`, `description`, `tags`, `productionVersion`。
至少包含内置 skills（`skill-creator`, `dynamic-mcp-builder`, `forge-sync`）。

```bash
curl -s -X POST $HUB/api/sync/discover \
  -H 'Content-Type: application/json' \
  -d '{"type":"mcp"}'
```
期望：返回 MCP 列表，每个元素包含 `name`, `description`, `enabled`, `productionVersion`。

**带 tag 过滤:**
```bash
curl -s -X POST $HUB/api/sync/discover \
  -H 'Content-Type: application/json' \
  -d '{"type":"skill","tag":"meta"}'
```
期望：只返回 tags 包含 `meta` 的 skills。

### 2. Diff — 对比本地与远程差异

**REST API:**
```bash
curl -s -X POST $SPOKE/api/sync/diff \
  -H 'Content-Type: application/json' \
  -d '{"type":"skill"}'
```
期望：返回 JSON 数组，每个元素包含 `name`, `localExists`, `remoteExists`, `status`。
`status` 值为 `local_only` / `remote_only` / `both` 之一。

**指定 names 过滤:**
```bash
curl -s -X POST $SPOKE/api/sync/diff \
  -H 'Content-Type: application/json' \
  -d '{"type":"skill","names":["skill-creator","forge-sync"]}'
```
期望：只返回指定 names 的 diff 结果。

### 3. Pull — 从 Hub 拉取到本地

找一个 `remote_only` 的 skill（或选择一个已有的测试）：
```bash
curl -s -X POST $SPOKE/api/sync/pull \
  -H 'Content-Type: application/json' \
  -d '{"type":"skill","name":"<skill-name>"}'
```
期望：
- 本地不存在时：返回 `action: "created"`，`localVersion: 1`
- 本地已存在时：返回 `action: "updated"`，`localVersion` 为新版本号

**验证 pull 结果:**
```bash
curl -s $SPOKE/api/skills/<skill-name>
```
期望：能读到 pull 下来的完整 skill 内容，与 hub 上的内容一致。

### 4. Push — 推送本地资源到 Hub

**REST API:**
```bash
curl -s -X POST $SPOKE/api/sync/push \
  -H 'Content-Type: application/json' \
  -d '{"type":"skill","name":"<skill-name>","targetUrl":"$HUB"}'
```
期望：返回 `action: "created"` 或 `"updated"`，`targetUrl` 为 hub 地址。

```bash
curl -s -X POST $SPOKE/api/sync/push \
  -H 'Content-Type: application/json' \
  -d '{"type":"mcp","name":"<mcp-name>","targetUrl":"$HUB"}'
```
期望：同上。`targetUrl` 可省略，默认使用 `FORGE_HUB_URL`。

### 5. 自同步保护（Hub 端验证）

在 Hub 上（`FORGE_IS_HUB=true`）调用 discover/diff/pull 不指定 `sourceUrl`：
```bash
curl -s -X POST $HUB/api/sync/discover \
  -H 'Content-Type: application/json' \
  -d '{"type":"skill"}'
```
期望：返回 400，error 包含 "Hub cannot sync with itself"。

### 6. 自定义 sourceUrl

从 Spoke 指定一个非默认的 sourceUrl：
```bash
curl -s -X POST $SPOKE/api/sync/discover \
  -H 'Content-Type: application/json' \
  -d '{"type":"skill","sourceUrl":"https://other-forge.example.com/"}'
```
期望：尝试连接指定 URL；如果不可达返回 error（非 500 crash）。

## 异常场景
- `type` 不是 `skill` 或 `mcp` → Zod 校验 400
- `name` 为空字符串 → Zod 校验 400
- Hub 不可达 → 返回明确 error message（含 HTTP status）
- Pull 不存在的 skill name → 返回 404 相关 error
