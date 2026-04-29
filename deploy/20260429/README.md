# 部署策略 - 2026-04-29

## 服务器信息
- 地址：root@agent.mob-ai.cn
- 认证：通过 `$SSHPASS` 环境变量传递密码

## 部署前备份（服务器端）

### 1. 备份当前版本
```bash
# 在服务器上执行
cd /root/agent-forge  # 假设项目路径
mkdir -p backups/pre-20260429

# 备份 .env
cp .env backups/pre-20260429/env.backup

# 备份 docker-compose 文件
cp docker-compose*.yml backups/pre-20260429/

# 备份数据库
docker exec agent-forge-db-dev pg_dump -U postgres -d agent_forge > backups/pre-20260429/agent_forge.sql
docker exec agent-forge-db-dev pg_dump -U postgres -d biz > backups/pre-20260429/biz.sql

# 记录当前 git commit
git rev-parse HEAD > backups/pre-20260429/git-commit.txt
```

### 2. 回滚步骤（如需恢复）
```bash
# 停止服务
docker compose down

# 恢复代码
git reset --hard $(cat backups/pre-20260429/git-commit.txt)

# 恢复 .env
cp backups/pre-20260429/env.backup .env

# 恢复 docker-compose
cp backups/pre-20260429/docker-compose*.yml .

# 恢复数据库
docker compose up -d
docker exec -i agent-forge-db-dev psql -U postgres -d agent_forge < backups/pre-20260429/agent_forge.sql
docker exec -i agent-forge-db-dev psql -U postgres -d biz < backups/pre-20260429/biz.sql

# 重启服务
docker compose restart
```

## 部署步骤

### 1. 执行服务器端备份（已完成）
```bash
sshpass -p "$SSHPASS" ssh root@agent.mob-ai.cn 'bash -s' < deploy/20260429/backup-server.sh
```
✅ 备份已完成：56MB agent_forge.sql + 248KB biz.sql

### 2. 构建并部署
```bash
bash deploy/20260429/build-and-deploy.sh
```

此脚本会：
- 构建 Docker 镜像（linux/amd64）
- 保存并传输镜像到服务器
- 服务器端加载镜像
- 执行数据库迁移
- 重启服务

### 3. 验证部署
```bash
curl https://agent.mob-ai.cn/api/health
```

## 注意事项
- 所有密钥通过 `$SSHPASS` 环境变量传递，不写入文件
- 备份文件保存在服务器 `backups/pre-20260429/` 目录
- 回滚前确认备份文件完整性
