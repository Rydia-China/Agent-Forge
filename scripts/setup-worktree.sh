#!/bin/bash
set -euo pipefail

# Setup script for new worktrees
# Ensures worktree has .env and dependencies installed

WORKTREE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MAIN_DIR="$(git worktree list --porcelain | grep -A2 "^worktree $(git rev-parse --show-toplevel)$" | grep "^worktree" | head -1 | cut -d' ' -f2)"

echo "🔧 Setting up worktree environment..."

# 1. Copy .env from main worktree
if [ -f "$MAIN_DIR/.env" ]; then
    echo "📋 Copying .env from main worktree..."
    cp "$MAIN_DIR/.env" "$WORKTREE_DIR/.env"
    echo "✅ .env copied"
else
    echo "⚠️  Warning: No .env found in main worktree"
    if [ -f "$MAIN_DIR/.env.example" ]; then
        echo "📋 Copying .env.example as template..."
        cp "$MAIN_DIR/.env.example" "$WORKTREE_DIR/.env"
        echo "⚠️  Please configure .env before running services"
    fi
fi

# 2. Install dependencies
echo "📦 Installing dependencies with pnpm..."
cd "$WORKTREE_DIR"
pnpm install

echo ""
echo "✅ Worktree setup complete!"
echo "📁 Worktree location: $WORKTREE_DIR"
echo ""
echo "Next steps:"
echo "  cd $WORKTREE_DIR"
echo "  # Start coding..."
