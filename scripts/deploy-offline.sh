#!/bin/bash
# 离线部署脚本：本地构建 -> 传输到服务器 -> 启动

set -e

SERVER="root@47.97.112.115"
REMOTE_PATH="/war/www/soft/agent-forge"
IMAGE_FILE="agent-forge.tar.gz"

echo "1️⃣  构建 linux/amd64 镜像..."
docker buildx build --platform linux/amd64 -t agent-forge:latest -f Dockerfile .

echo "2️⃣  导出镜像..."
docker save agent-forge:latest | gzip > $IMAGE_FILE

echo "3️⃣  传输到服务器..."
scp $IMAGE_FILE $SERVER:$REMOTE_PATH/

echo "4️⃣  在服务器上加载镜像并启动..."
ssh $SERVER << 'ENDSSH'
cd /war/www/soft/agent-forge
docker load < agent-forge.tar.gz
docker compose -f docker-compose.prod.yml up -d
ENDSSH

echo "✅ 部署完成"
echo "查看日志: ssh $SERVER 'cd $REMOTE_PATH && docker compose -f docker-compose.prod.yml logs -f app'"
