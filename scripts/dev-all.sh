#!/bin/bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

MCP_PROXY_PORT="${MCP_PROXY_PORT:-8002}"
NEXT_PORT="${PORT:-8001}"
MCP_PROXY_PID_FILE="$REPO_DIR/.git/mcp-proxy.pid"
NEXTJS_PID_FILE="$REPO_DIR/.git/nextjs.pid"
PROTECTION_PID_FILE="$REPO_DIR/.git/protection-daemon.pid"

LOG_DIR="$REPO_DIR/logs"
mkdir -p "$LOG_DIR"

cleanup() {
    echo ""
    echo "🛑 Shutting down services..."
    
    if [ -f "$PROTECTION_PID_FILE" ]; then
        PROTECTION_PID=$(cat "$PROTECTION_PID_FILE")
        if kill -0 "$PROTECTION_PID" 2>/dev/null; then
            echo "  • Stopping protection daemon (PID: $PROTECTION_PID)..."
            kill "$PROTECTION_PID" 2>/dev/null || true
            rm -f "$PROTECTION_PID_FILE"
        fi
    fi
    
    if [ -f "$NEXTJS_PID_FILE" ]; then
        NEXTJS_PID=$(cat "$NEXTJS_PID_FILE")
        if kill -0 "$NEXTJS_PID" 2>/dev/null; then
            echo "  • Stopping Next.js Dev Server (PID: $NEXTJS_PID)..."
            kill "$NEXTJS_PID" 2>/dev/null || true
            rm -f "$NEXTJS_PID_FILE"
        fi
    fi
    
    if [ -f "$MCP_PROXY_PID_FILE" ]; then
        MCP_PROXY_PID=$(cat "$MCP_PROXY_PID_FILE")
        if kill -0 "$MCP_PROXY_PID" 2>/dev/null; then
            echo "  • Stopping MCP Proxy (PID: $MCP_PROXY_PID)..."
            kill "$MCP_PROXY_PID" 2>/dev/null || true
            rm -f "$MCP_PROXY_PID_FILE"
        fi
    fi
    
    echo "✅ All services stopped"
    exit 0
}

trap cleanup INT TERM

echo "🚀 Starting Agent-Forge Development Environment"
echo "================================================"

echo "📡 Starting MCP Proxy on port $MCP_PROXY_PORT..."
MCP_PROXY_PORT=$MCP_PROXY_PORT node "$REPO_DIR/scripts/mcp-proxy.js" >> "$LOG_DIR/mcp-proxy.log" 2>&1 &
MCP_PROXY_PID=$!
echo "$MCP_PROXY_PID" > "$MCP_PROXY_PID_FILE"
echo "✅ MCP Proxy started (PID: $MCP_PROXY_PID)"

sleep 1

echo "🌐 Starting Next.js Dev Server on port $NEXT_PORT..."
PORT=$NEXT_PORT pnpm run dev >> "$LOG_DIR/nextjs.log" 2>&1 &
NEXTJS_PID=$!
echo "$NEXTJS_PID" > "$NEXTJS_PID_FILE"
echo "✅ Next.js Dev Server started (PID: $NEXTJS_PID)"

sleep 2

echo "🛡️  Starting Main Branch Protection Daemon..."
"$REPO_DIR/scripts/protection-daemon.sh" start
echo "✅ Protection daemon started"

echo "================================================"
echo "✅ All services started successfully!"
echo ""
echo "📊 Service Status:"
echo "  • Next.js Dev:  http://localhost:$NEXT_PORT"
echo "  • MCP Proxy:    http://localhost:$MCP_PROXY_PORT"
echo ""
echo "📝 Logs:"
echo "  • MCP Proxy:    tail -f ./logs/mcp-proxy.log"
echo "  • Next.js:      tail -f ./logs/nextjs.log"
echo ""
echo "🛑 Stop services:"
echo "  • Press Ctrl+C or run: pnpm run dev:stop"
echo ""

wait
