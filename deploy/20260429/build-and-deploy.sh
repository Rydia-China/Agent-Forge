#!/bin/bash
set -e

echo "=== 开始构建和部署 ==="

# 1. 构建 Docker 镜像
echo "1. 构建 Docker 镜像..."
docker buildx build --platform linux/amd64 -t agent-forge:latest -f Dockerfile . --load

# 2. 保存镜像为 tar 文件
echo "2. 保存镜像..."
docker save agent-forge:latest | gzip > /tmp/agent-forge-latest.tar.gz

# 3. 传输到服务器
echo "3. 传输镜像到服务器..."
sshpass -p "$SSHPASS" scp /tmp/agent-forge-latest.tar.gz root@agent.mob-ai.cn:/tmp/

# 4. 服务器端加载镜像并重启
echo "4. 服务器端部署..."
sshpass -p "$SSHPASS" ssh root@agent.mob-ai.cn 'bash -s' <<'REMOTE_SCRIPT'
set -e

cd /var/www/agent-forge

echo "加载新镜像..."
docker load < /tmp/agent-forge-latest.tar.gz

echo "停止旧服务..."
docker compose -f docker-compose.prod.yml down app

echo "执行数据库迁移..."
# 临时启动容器执行迁移
docker run --rm --network agent-forge_app-network \
  --env-file .env \
  -e DATABASE_URL="postgresql://postgres:12345678@agent-forge-db-1:5432/agent_forge" \
  -e BUSINESS_DATABASE_URL="postgresql://postgres:12345678@agent-forge-db-1:5432/biz" \
  agent-forge:latest \
  sh -c "npx prisma db push"

echo "启动新服务..."
docker compose -f docker-compose.prod.yml up -d app

echo "清理临时文件..."
rm -f /tmp/agent-forge-latest.tar.gz

echo "等待服务启动..."
sleep 10

echo "检查服务状态..."
docker ps | grep agent-forge
REMOTE_SCRIPT

# 5. 清理本地临时文件
echo "5. 清理本地临时文件..."
rm -f /tmp/agent-forge-latest.tar.gz

echo ""
echo "=== 部署完成 ==="
echo "验证服务: curl https://agent.mob-ai.cn/api/health"
