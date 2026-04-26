#!/bin/sh
set -e

# ── 等待数据库就绪（重试 30 次，间隔 2s）──
wait_for_db() {
  local url="$1"
  local label="$2"
  echo "⏳ 等待 ${label} 就绪..."
  local max=30 retry=0
  until node -e "
    const { Client } = require('pg');
    const c = new Client('${url}');
    c.connect().then(() => { c.end(); process.exit(0); }).catch(() => process.exit(1));
  " 2>/dev/null; do
    retry=$((retry + 1))
    if [ "$retry" -ge "$max" ]; then
      echo "❌ ${label} 连接超时（${max} 次重试）"
      exit 1
    fi
    echo "  重试 $retry/$max..."
    sleep 2
  done
}

wait_for_db "$DATABASE_URL" "数据库"

echo "📦 同步数据库 schema..."
npx prisma db push --skip-generate

echo "🚀 启动应用..."
exec pnpm start
