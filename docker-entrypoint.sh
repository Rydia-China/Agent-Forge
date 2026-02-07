#!/bin/sh
set -e

echo "⏳ 等待数据库就绪..."
sleep 3

echo "📦 同步数据库结构..."
npx prisma db push --skip-generate --accept-data-loss

echo "🚀 启动应用..."
exec npm start
