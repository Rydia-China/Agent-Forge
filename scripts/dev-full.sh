#!/bin/bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

echo "🚀 Starting Agent-Forge development environment..."

trap 'echo ""; echo "🛑 Shutting down..."; ./scripts/protection-daemon.sh stop; exit 0' INT TERM

./scripts/protection-daemon.sh start

echo "✅ Main branch protection enabled"
echo "📝 Protection logs: .git/main-protection.log"
echo ""
echo "Starting Next.js dev server..."
echo ""

pnpm run dev
