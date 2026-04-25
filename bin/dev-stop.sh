#!/bin/bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

MCP_PROXY_PID_FILE="$REPO_DIR/.git/mcp-proxy.pid"
NEXTJS_PID_FILE="$REPO_DIR/.git/nextjs.pid"
PROTECTION_PID_FILE="$REPO_DIR/.git/protection-daemon.pid"

echo "🛑 Stopping all services..."

if [ -f "$PROTECTION_PID_FILE" ]; then
    PROTECTION_PID=$(cat "$PROTECTION_PID_FILE")
    if kill -0 "$PROTECTION_PID" 2>/dev/null; then
        echo "  • Stopping protection daemon (PID: $PROTECTION_PID)..."
        kill "$PROTECTION_PID" 2>/dev/null || true
    fi
    rm -f "$PROTECTION_PID_FILE"
fi

if [ -f "$NEXTJS_PID_FILE" ]; then
    NEXTJS_PID=$(cat "$NEXTJS_PID_FILE")
    if kill -0 "$NEXTJS_PID" 2>/dev/null; then
        echo "  • Stopping Next.js Dev Server (PID: $NEXTJS_PID)..."
        kill "$NEXTJS_PID" 2>/dev/null || true
    fi
    rm -f "$NEXTJS_PID_FILE"
fi

if [ -f "$MCP_PROXY_PID_FILE" ]; then
    MCP_PROXY_PID=$(cat "$MCP_PROXY_PID_FILE")
    if kill -0 "$MCP_PROXY_PID" 2>/dev/null; then
        echo "  • Stopping MCP Proxy (PID: $MCP_PROXY_PID)..."
        kill "$MCP_PROXY_PID" 2>/dev/null || true
    fi
    rm -f "$MCP_PROXY_PID_FILE"
fi

echo "✅ All services stopped"
