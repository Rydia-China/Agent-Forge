# 生产部署手册

生产部署唯一入口是 `pnpm deploy:prod`，底层调用 `scripts/deploy-prod-offline.sh`。

## 服务器

- 地址：`root@agent.mob-ai.cn`
- 运行目录：`/var/www/agent-forge`
- Git 源码目录：`/var/www/agent-forge/source`
- 认证：只允许通过环境变量 `SSHPASS` 传递密码，脚本固定使用 `sshpass -e`
- 代码来源：服务器从 Git 拉取 tag 并在服务器构建镜像，部署前必须先把 tag 推送到远端

## 完整部署

```bash
SSHPASS=... pnpm deploy:prod -- --tag 0.0.4
```

完整部署会按顺序执行：

1. 校验当前 worktree 干净
2. 校验 `--tag` 指向当前 `HEAD`，或通过 `--retag` 重打本地 tag
3. 校验 tag 已经存在于 `origin`
4. 备份本地 `.env`、`agent_forge`、`biz`
5. 导出核心同步表：`Skill`、`StylePreset`、`ApiUsageCounter`
6. 备份服务器 `.env`、compose 文件、`agent_forge`、`biz`
7. 将服务器备份拉回本地 `backups/deploy-<tag>-<timestamp>/server/`
8. 覆盖服务器 `.env`，覆盖前额外备份到服务器 `backups/env-overwrite-<tag>-<timestamp>/`
9. 服务器 clone/fetch Git 仓库，checkout 指定 tag
10. 服务器构建 `linux/amd64` 镜像 `agent-forge:<tag>` 和 `agent-forge:latest`
11. 重建 app 容器，等待 Docker healthcheck
12. 同步核心表
13. 验证公网 `/api/health`、外部分发 OSS 上传认证链路、容器内 health、源码 commit、核心表计数
14. 清理本地和服务器 `/tmp` 中的部署临时文件

## 模式

```bash
# 仅备份本地和服务器，不部署
SSHPASS=... pnpm deploy:prod -- --mode backup

# 仅让服务器拉取 tag 并构建镜像，不重启服务器 app
SSHPASS=... pnpm deploy:prod -- --mode build --tag 0.0.4

# 仅覆盖服务器 .env，随后重建 app 并验证
SSHPASS=... pnpm deploy:prod -- --mode sync-env

# 仅同步核心表并验证
SSHPASS=... pnpm deploy:prod -- --mode sync-tables

# 仅验证线上状态
SSHPASS=... pnpm deploy:prod -- --mode verify
```

## 选项

```bash
# tag 已经指向当前 HEAD 时，不重打 tag
SSHPASS=... pnpm deploy:prod -- --tag 0.0.4

# 完整部署但不覆盖服务器 .env
SSHPASS=... pnpm deploy:prod -- --tag 0.0.4 --skip-env

# 完整部署但不同步核心表
SSHPASS=... pnpm deploy:prod -- --tag 0.0.4 --skip-table-sync

# 指定同步表
SSHPASS=... pnpm deploy:prod -- --mode sync-tables --tables Skill,StylePreset,ApiUsageCounter

# 使用非默认 Git 地址
SSHPASS=... pnpm deploy:prod -- --tag 0.0.4 --repo-url git@github.com:Rydia-China/Agent-Forge.git
```

## 备份位置

脚本每次执行会创建本地备份目录：

```text
backups/deploy-<tag-or-manual>-<timestamp>/
```

目录内固定包含：

- `local/`：本地 `.env`、`agent_forge`、`biz`、commit/tag 记录
- `server/`：从服务器拉回的 `.env`、compose 文件、`agent_forge`、`biz`、部署前镜像记录
- `sync/`：准备同步到服务器的核心表 SQL

服务器侧保留同名备份目录：

```text
/var/www/agent-forge/backups/deploy-<tag-or-manual>-<timestamp>/
/var/www/agent-forge/backups/env-overwrite-<tag-or-manual>-<timestamp>/
```

## 回滚

回滚前先确认对应备份目录完整。回滚步骤记录在 `deploy/20260429/ROLLBACK.md`。

## 约束

- 不直接执行旧的 `deploy/20260429/backup-server.sh` 或 `deploy/20260429/build-and-deploy.sh` 作为主流程
- 不在本地构建和上传镜像；生产镜像必须由服务器从 Git tag 拉取源码后构建
- 不使用 `sshpass -p`，只使用 `SSHPASS=...` + `sshpass -e`
- 不部署未推送 tag；服务器必须能从 `--repo-url` 拉到指定 tag
- 生产 `.env` 覆盖必须由脚本执行，覆盖前脚本会自动备份服务器原配置
- 完整部署后必须通过脚本内置验证
