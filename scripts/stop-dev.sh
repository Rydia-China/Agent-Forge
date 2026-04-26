#!/bin/bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

echo "🛑 Stopping Agent-Forge development environment..."

# Stop protection daemon
./scripts/protection-daemon.sh stop

# Kill Next.js dev server on port 8001
PORT=${PORT:-8001}
if lsof -ti:$PORT > /dev/null 2>&1; then
  echo "Killing process on port $PORT..."
  kill -9 $(lsof -ti:$PORT) 2>/dev/null || true
fi

# Kill any remaining Next.js processes
pkill -9 -f "next-server" 2>/dev/null || true
pkill -9 -f "node.*\.next" 2>/dev/null || true

echo "✅ Development environment stopped"
