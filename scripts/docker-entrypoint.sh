#!/bin/sh
set -e

# ── 等待数据库就绪（重试 30 次，间隔 2s）──
wait_for_db() {
  local url="$1"
  local label="$2"
  echo "⏳ 等待 ${label} 就绪..."
  local max=30 retry=0
  until node -e "
    const net = require('net');
    const target = new URL(process.argv[1]);
    const socket = net.createConnection({
      host: target.hostname,
      port: Number(target.port || 5432),
    });
    const timer = setTimeout(() => {
      socket.destroy();
      process.exit(1);
    }, 2000);
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.end();
      process.exit(0);
    });
    socket.once('error', () => {
      clearTimeout(timer);
      process.exit(1);
    });
  " "$url" 2>/dev/null; do
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

echo "📦 应用数据库迁移..."
node node_modules/prisma/build/index.js migrate deploy --schema=prisma/schema.prisma

echo "🚀 启动应用..."
exec node server.js
