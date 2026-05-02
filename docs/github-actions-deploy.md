# GitHub Actions Registry Deploy

本仓库的 GitHub Actions 部署只负责应用镜像发布：在 GitHub runner 上构建 linux/amd64 Docker 镜像，推送到私有 Docker Registry 的 origin 入口，然后通过 SSH 通知服务器从 CDN pull 入口拉取并重建 app 容器。

生产镜像使用 Next.js standalone 输出运行应用，同时保留一个独立 Prisma CLI runtime 用于启动前执行 migrations。构建上下文会排除 `backups/`、`temp/`、`logs/` 等本地产物，避免把备份和调试文件打进镜像。

它不会在 GitHub runner 或宿主机上直接修改生产数据库，也不会覆盖服务器 `.env`。
生产数据库结构由镜像内的 `prisma/migrations` 管理，app 容器启动时会先执行 `prisma migrate deploy`，再启动服务。
服务器 `.env` 仍使用本地手动命令同步：

```bash
pnpm deploy:prod -- --mode sync-env
```

## Database Migrations

生产数据库 schema 只通过 Git 中的 `prisma/migrations` 演进。新增或修改 schema 时，先在开发库生成并验证 migration，再提交 `prisma/schema.prisma` 和对应 `prisma/migrations/.../migration.sql`。

生产部署只执行 `prisma migrate deploy`。不要在生产路径使用 `prisma db push`，也不要用 `--accept-data-loss` 自动确认破坏性变更。

如果历史上已经通过 `db push` 手工同步过结构，可能出现“表已存在但 `_prisma_migrations` 没有对应 applied 记录”的断层。处理方式是先核对生产表结构与 migration SQL 完全一致，再用 `prisma migrate resolve --applied <migration_name>` 补齐该数据库自己的迁移账本；这不是替代 Git migration，只是修复单个数据库的历史记录。

## Branches

- `main`：正式代码主线
- `test`：测试代码主线
- `deploy/prod`：生产部署触发分支
- `deploy/test`：测试部署触发分支

推荐操作方式：

```bash
# 部署测试环境
git checkout deploy/test
git merge --ff-only test
git push origin deploy/test

# 部署生产环境
git checkout deploy/prod
git merge --ff-only main
git push origin deploy/prod
```

也可以在 GitHub Actions 页面手动运行 `Registry Deploy`，选择 `testing` 或 `production`。

## Queueing

Workflow 使用 `concurrency`，同一目标环境的部署会排队执行：

- `deploy/prod` 和手动 `production` 共用生产队列
- `deploy/test` 和手动 `testing` 共用测试队列

`cancel-in-progress: false`，因此新的部署不会取消正在执行的部署。

## GitHub Environments

在 GitHub 仓库 Settings -> Environments 创建两个环境：

- `production`
- `testing`

每个环境配置同名变量和密钥。

Variables:

```text
SSH_HOST=agent.mob-ai.cn
SSH_USER=root
PROJECT_DIR=/var/www/agent-forge
PUBLIC_HOST=agent.mob-ai.cn
REGISTRY_PUSH_IMAGE=registry-origin.mob-ai.cn/agent-forge
REGISTRY_PULL_IMAGE=registry.mob-ai.cn/agent-forge
REGISTRY_USERNAME=agent_forge
```

`REGISTRY_IMAGE` 是旧配置兼容项，新部署不需要再配置。新部署应显式配置：

- `REGISTRY_PUSH_IMAGE`：GitHub runner push 使用，必须走 origin，不经过 CDN。
- `REGISTRY_PULL_IMAGE`：服务器 pull 使用，走 CDN 和 OSS-backed registry。

Secrets:

```text
SSH_PRIVATE_KEY=<private key used to ssh into the server>
REGISTRY_PASSWORD=<private registry password>
```

生产和测试环境可以使用不同服务器，只要在对应 Environment 中填不同变量即可。

## Server Requirements

服务器需要提前具备：

- Docker / Docker Compose
- 已存在的 `docker-compose.prod.yml` 运行目录
- 已配置好的 `.env`
- 可通过上面的 SSH key 登录

GitHub Actions 不在服务器上构建镜像，只执行：

```bash
docker login registry.mob-ai.cn
docker pull registry.mob-ai.cn/agent-forge:<tag>
docker tag registry.mob-ai.cn/agent-forge:<tag> agent-forge:latest
docker compose -f docker-compose.prod.yml up -d app
```

registry 部署会先提交远端后台任务，再用短 SSH 连接轮询 `deploy-runs/<tag>-<stamp>/status`。这样 GitHub runner 到生产服务器的单条 SSH 连接断开时，服务器上的拉取任务不会被杀掉。

远端 `deploy.log` 会把部署拆成独立阶段：

- `phase=pull`：从 `REGISTRY_PULL_IMAGE` 拉取镜像。
- `phase=tag`：把远端镜像标记为 `agent-forge:latest`。
- `phase=start`：停止旧 app 容器并启动新 app 容器。
- `phase=healthcheck`：等待 `agent-forge-app-1` 健康检查通过。

每个阶段都会记录 `event=start` / `event=finish` 和 `duration_seconds`，用于区分 CDN/OSS 下载慢、Docker 本地解包慢、容器启动慢。

## Local Equivalent

GitHub Actions 调用的是同一个脚本的 CI 安全模式：

```bash
pnpm deploy:prod -- \
  --mode registry-deploy \
  --tag production-$(git rev-parse --short=12 HEAD) \
  --skip-git-tag-check \
  --skip-table-sync \
  --skip-remote-pullback \
  --server root@agent.mob-ai.cn \
  --project-dir /var/www/agent-forge \
  --registry-push-image registry-origin.mob-ai.cn/agent-forge \
  --registry-pull-image registry.mob-ai.cn/agent-forge \
  --public-host agent.mob-ai.cn
```

完整本地发布仍可使用原命令，它会额外做本地 DB 备份、`.env` 同步和表同步：

```bash
SSHPASS=... pnpm deploy:prod -- --tag v0.1.4
```
