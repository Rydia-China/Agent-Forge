#!/bin/sh
set -e

# ── 等待数据库就绪（重试 30 次，间隔 2s）──
echo "⏳ 等待数据库就绪..."
MAX_RETRIES=30
RETRY=0
until node -e "
  const { Client } = require('pg');
  const c = new Client(process.env.DATABASE_URL);
  c.connect().then(() => { c.end(); process.exit(0); }).catch(() => process.exit(1));
" 2>/dev/null; do
  RETRY=$((RETRY + 1))
  if [ "$RETRY" -ge "$MAX_RETRIES" ]; then
    echo "❌ 数据库连接超时（${MAX_RETRIES} 次重试）"
    exit 1
  fi
  echo "  重试 $RETRY/$MAX_RETRIES..."
  sleep 2
done

echo "📦 执行数据库迁移..."
npx prisma migrate deploy

echo "🚀 启动应用..."
exec pnpm start
