#!/bin/bash
set -e

echo "=== 开始部署新版本 ==="

# 检测项目路径
if [ -d "/var/www/agent-forge" ]; then
    PROJECT_DIR="/var/www/agent-forge"
elif [ -d "/root/agent-forge" ]; then
    PROJECT_DIR="/root/agent-forge"
elif [ -d "/root/Agent-Forge" ]; then
    PROJECT_DIR="/root/Agent-Forge"
else
    echo "错误：未找到项目目录"
    exit 1
fi

cd "$PROJECT_DIR"
echo "项目路径: $PROJECT_DIR"

# 1. 拉取最新代码
echo "1. 拉取最新代码..."
git fetch origin
git checkout main
git pull origin main

# 2. 安装依赖
echo "2. 安装依赖..."
pnpm install

# 3. 构建项目
echo "3. 构建项目..."
pnpm build

# 4. 数据库迁移
echo "4. 执行数据库迁移..."
npx prisma db push

# 5. 重启服务
echo "5. 重启服务..."
docker compose restart

echo ""
echo "=== 部署完成 ==="
echo "请执行健康检查: curl https://agent.mob-ai.cn/health"
