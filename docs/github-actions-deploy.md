# GitHub Actions Offline Deploy

本仓库的 GitHub Actions 部署只负责应用镜像发布：在 GitHub runner 上构建 linux/amd64 Docker 镜像，打成 `tar.gz` 包，通过 SSH 上传到服务器，服务器执行 `docker load` 后重建 app 容器。

它不会同步生产数据库表，也不会覆盖服务器 `.env`。数据库/Skills 同步继续使用本地手动命令：

```bash
pnpm deploy:prod -- --mode sync-tables
pnpm deploy:prod -- --mode sync-env
```

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

也可以在 GitHub Actions 页面手动运行 `Offline Deploy`，选择 `testing` 或 `production`。

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
```

Secrets:

```text
SSH_PRIVATE_KEY=<private key used to ssh into the server>
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
docker load < agent-forge-*.tar.gz
docker compose -f docker-compose.prod.yml up -d app
```

## Local Equivalent

GitHub Actions 调用的是同一个脚本的 CI 安全模式：

```bash
pnpm deploy:prod -- \
  --mode image-deploy \
  --tag production-$(git rev-parse --short=12 HEAD) \
  --skip-git-tag-check \
  --skip-table-sync \
  --skip-remote-pullback \
  --server root@agent.mob-ai.cn \
  --project-dir /var/www/agent-forge \
  --public-host agent.mob-ai.cn
```

完整本地发布仍可使用原命令，它会额外做本地 DB 备份、`.env` 同步和表同步：

```bash
SSHPASS=... pnpm deploy:prod -- --tag v0.1.4
```
