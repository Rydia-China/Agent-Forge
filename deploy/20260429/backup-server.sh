#!/bin/bash
set -e

echo "=== 开始备份服务器当前版本 ==="

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
BACKUP_DIR="backups/pre-20260429"
mkdir -p "$BACKUP_DIR"

echo "项目路径: $PROJECT_DIR"
echo "备份目录: $BACKUP_DIR"

# 1. 备份 .env
if [ -f ".env" ]; then
    cp .env "$BACKUP_DIR/env.backup"
    echo "✓ 已备份 .env"
else
    echo "⚠ 未找到 .env 文件"
fi

# 2. 备份 docker-compose 文件
cp docker-compose*.yml "$BACKUP_DIR/" 2>/dev/null || echo "⚠ 未找到 docker-compose 文件"
echo "✓ 已备份 docker-compose 文件"

# 3. 检测数据库容器名
DB_CONTAINER=$(docker ps --filter "name=agent-forge-db" --format "{{.Names}}" | head -n1)
if [ -z "$DB_CONTAINER" ]; then
    DB_CONTAINER=$(docker ps --filter "name=postgres" --filter "name=agent-forge" --format "{{.Names}}" | head -n1)
fi
if [ -z "$DB_CONTAINER" ]; then
    DB_CONTAINER=$(docker ps --filter "ancestor=postgres" --format "{{.Names}}" | head -n1)
fi

if [ -z "$DB_CONTAINER" ]; then
    echo "⚠ 未找到数据库容器，跳过数据库备份"
else
    echo "数据库容器: $DB_CONTAINER"

    # 4. 备份数据库
    docker exec "$DB_CONTAINER" pg_dump -U postgres -d agent_forge > "$BACKUP_DIR/agent_forge.sql" 2>/dev/null || echo "⚠ agent_forge 数据库备份失败"
    docker exec "$DB_CONTAINER" pg_dump -U postgres -d biz > "$BACKUP_DIR/biz.sql" 2>/dev/null || echo "⚠ biz 数据库备份失败"
    echo "✓ 已备份数据库"
fi

# 5. 记录当前 git commit
if [ -d ".git" ]; then
    git rev-parse HEAD > "$BACKUP_DIR/git-commit.txt"
    echo "✓ 已记录 git commit: $(cat $BACKUP_DIR/git-commit.txt)"
else
    echo "⚠ 不是 git 仓库"
fi

# 6. 生成备份清单
echo "=== 备份清单 ===" > "$BACKUP_DIR/manifest.txt"
ls -lh "$BACKUP_DIR" >> "$BACKUP_DIR/manifest.txt"

echo ""
echo "=== 备份完成 ==="
cat "$BACKUP_DIR/manifest.txt"
