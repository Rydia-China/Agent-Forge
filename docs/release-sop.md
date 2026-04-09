# 发布 SOP

## 前置条件

- Docker Desktop 运行中，已登录 `ghcr.io`（`docker login ghcr.io`）
- 本地开发数据库运行中（`docker ps` 确认 `agent-forge-db-dev`）
- 生产服务器 SSH 可达：`root@agent.mob-ai.cn`（密码存于 `$SSHPASS`）
- 安装 `sshpass`（`brew install hudochenkov/sshpass/sshpass`）

## 步骤

### 1. 导出数据

从本地开发数据库导出 Skill、McpServer、StylePreset 到 `data/` 目录：

```sh
pnpm db:export
```

产出文件：
- `data/skills.json`
- `data/mcp-servers.json`
- `data/style-presets.json`

> 导出的是 production 版本快照，所有类型均使用 create-if-not-exists 策略导入（已存在的不覆盖）。
> 如需强制同步远程修改，先通过 API 或 DB 手动更新，不要依赖发布流程覆盖。

### 2. 提交变更

确保 `data/` 目录下的 JSON 和本次所有代码变更已提交：

```sh
git add -A && git commit -m "release: <简述>"
```

### 3. 构建镜像

```sh
docker buildx build --platform linux/amd64 -t agent-forge:latest -f Dockerfile . --load
```

### 4. 部署到生产

设置 SSH 密码（如当前 shell 未设置）：

```sh
export SSHPASS='<password>'
```

两种方式二选一：

#### 方式 A：本地上传（推荐，无需 ghcr.io）

通过管道直传镜像到服务器并重启：

```sh
docker save agent-forge:latest | gzip | \
  sshpass -e ssh -o StrictHostKeyChecking=no root@agent.mob-ai.cn 'gunzip | docker load'

sshpass -e ssh root@agent.mob-ai.cn \
  'cd /war/www/soft/agent-forge && docker compose -f docker-compose.prod.yml up -d'
```

#### 方式 B：通过 ghcr.io 中转

先推送到 ghcr.io（需 `docker login ghcr.io`）：

```sh
docker tag agent-forge:latest ghcr.io/rydia-china/agent-forge:latest
docker push ghcr.io/rydia-china/agent-forge:latest
```

再从服务器拉取：

```sh
sshpass -e ssh -o StrictHostKeyChecking=no root@agent.mob-ai.cn \
  'docker pull ghcr.io/rydia-china/agent-forge:latest && \
   docker tag ghcr.io/rydia-china/agent-forge:latest agent-forge:latest && \
   cd /war/www/soft/agent-forge && \
   docker compose -f docker-compose.prod.yml up -d'
```

> 生产 docker-compose 使用本地镜像名 `agent-forge:latest`。

### 5. 验证

#### 检查容器状态

```sh
sshpass -e ssh root@agent.mob-ai.cn 'docker ps --format "table {{.Names}}\t{{.Status}}"'
```

三个容器均应为 `Up` + `(healthy)`。

#### 检查启动日志（含数据导入）

```sh
sshpass -e ssh root@agent.mob-ai.cn 'docker logs agent-forge-app-1 2>&1 | tail -15'
```

确认出现：
- `📥 数据导入完成：Skills +N, McpServers +N, StylePresets +N`（首次）
- 或 `📥 数据导入完成：Skills +0, McpServers +0, StylePresets +0`（重复部署，已有数据不覆盖）

#### 健康检查

```sh
curl -s https://agent.mob-ai.cn/api/health
```

返回 `{"status":"ok"}` 即正常。

## 回滚

如需回滚到上一版本：

```sh
# 在服务器上查看历史镜像
sshpass -e ssh root@agent.mob-ai.cn 'docker images agent-forge --format "{{.ID}}\t{{.CreatedAt}}"'

# 用指定镜像 ID 回滚
sshpass -e ssh root@agent.mob-ai.cn \
  'docker tag <IMAGE_ID> agent-forge:latest && \
   cd /war/www/soft/agent-forge && \
   docker compose -f docker-compose.prod.yml up -d'
```

## 自动化流程

容器启动时（`docker-entrypoint.sh`）自动执行：
1. 等待数据库就绪
2. `prisma db push` 同步 schema
3. `node scripts/db-import.js` 导入初始数据（幂等，失败不阻塞启动）
4. 启动应用

因此 **步骤 4 完成后数据会自动导入**，无需手动执行 import。
