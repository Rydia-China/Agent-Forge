# 生产部署手册

生产部署唯一入口是 `scripts/deploy-prod-offline.sh`，通过 `pnpm deploy:prod:offline` 调用。

## 服务器

- 地址：`root@agent.mob-ai.cn`
- 项目目录：`/var/www/agent-forge`
- 认证：只允许通过环境变量 `SSHPASS` 传递密码，脚本固定使用 `sshpass -e`

## 完整部署

```bash
SSHPASS=... pnpm deploy:prod:offline -- --tag v0.0.2 --retag
```

完整部署会按顺序执行：

1. 校验当前 worktree 干净
2. 校验 `--tag` 指向当前 `HEAD`，或通过 `--retag` 重打本地 tag
3. 备份本地 `.env`、`agent_forge`、`biz`
4. 导出核心同步表：`Skill`、`StylePreset`、`ApiUsageCounter`
5. 备份服务器 `.env`、compose 文件、`agent_forge`、`biz`
6. 将服务器备份拉回本地 `backups/deploy-<tag>-<timestamp>/server/`
7. 构建 `linux/amd64` 镜像并上传服务器
8. 覆盖服务器 `.env`，覆盖前额外备份到服务器 `backups/env-overwrite-<tag>-<timestamp>/`
9. 重建 app 容器，等待 Docker healthcheck
10. 同步核心表
11. 验证公网 `/api/health`、外部分发 OSS 上传认证链路、容器内 health、核心表计数
12. 清理本地和服务器 `/tmp` 中的部署临时文件

## 模式

```bash
# 仅备份本地和服务器，不部署
SSHPASS=... pnpm deploy:prod:offline -- --mode backup

# 仅构建并上传镜像，不重启服务器 app
SSHPASS=... pnpm deploy:prod:offline -- --mode build --tag v0.0.2 --retag

# 仅覆盖服务器 .env，随后重建 app 并验证
SSHPASS=... pnpm deploy:prod:offline -- --mode sync-env

# 仅同步核心表并验证
SSHPASS=... pnpm deploy:prod:offline -- --mode sync-tables

# 仅验证线上状态
SSHPASS=... pnpm deploy:prod:offline -- --mode verify
```

## 选项

```bash
# tag 已经指向当前 HEAD 时，不重打 tag
SSHPASS=... pnpm deploy:prod:offline -- --tag v0.0.2

# 完整部署但不覆盖服务器 .env
SSHPASS=... pnpm deploy:prod:offline -- --tag v0.0.2 --skip-env

# 完整部署但不同步核心表
SSHPASS=... pnpm deploy:prod:offline -- --tag v0.0.2 --skip-table-sync

# 指定同步表
SSHPASS=... pnpm deploy:prod:offline -- --mode sync-tables --tables Skill,StylePreset,ApiUsageCounter
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
- 不使用 `sshpass -p`，只使用 `SSHPASS=...` + `sshpass -e`
- 生产 `.env` 覆盖必须由脚本执行，覆盖前脚本会自动备份服务器原配置
- 完整部署后必须通过脚本内置验证
