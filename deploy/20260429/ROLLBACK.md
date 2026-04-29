# 回滚指南 - 恢复到 2026-04-29 部署前版本

## 备份位置
服务器路径：`/var/www/agent-forge/backups/pre-20260429/`

## 备份内容
- `env.backup` - 环境变量配置
- `docker-compose.prod.yml` - Docker Compose 配置
- `agent_forge.sql` - 主数据库备份 (56MB)
- `biz.sql` - 业务数据库备份 (248KB)
- `manifest.txt` - 备份清单

## 回滚步骤

### 1. 连接服务器
```bash
sshpass -p "$SSHPASS" ssh root@agent.mob-ai.cn
```

### 2. 进入项目目录
```bash
cd /var/www/agent-forge
```

### 3. 停止服务
```bash
docker compose down
```

### 4. 恢复环境变量
```bash
cp backups/pre-20260429/env.backup .env
```

### 5. 恢复 Docker Compose 配置
```bash
cp backups/pre-20260429/docker-compose.prod.yml .
```

### 6. 启动数据库容器
```bash
docker compose up -d db
# 等待数据库启动
sleep 10
```

### 7. 恢复数据库
```bash
# 恢复主数据库
docker exec -i agent-forge-db-1 psql -U postgres -d agent_forge < backups/pre-20260429/agent_forge.sql

# 恢复业务数据库
docker exec -i agent-forge-db-1 psql -U postgres -d biz < backups/pre-20260429/biz.sql
```

### 8. 启动所有服务
```bash
docker compose up -d
```

### 9. 验证服务
```bash
# 检查容器状态
docker ps

# 检查服务健康
curl https://agent.mob-ai.cn/health
```

## 注意事项
- 回滚前确认备份文件完整性（检查文件大小）
- 数据库恢复会覆盖当前数据，确保已保存重要数据
- 回滚后需要重启所有依赖服务
- 如果回滚失败，检查 Docker 日志：`docker logs agent-forge-app-1`
