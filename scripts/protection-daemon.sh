#!/bin/bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PROTECTION_SCRIPT="$REPO_DIR/scripts/protect-main-branch.sh"
DAEMON_PID_FILE="$REPO_DIR/.git/protection-daemon.pid"
DAEMON_LOG="$REPO_DIR/.git/protection-daemon.log"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

start_protection_daemon() {
    if [ -f "$DAEMON_PID_FILE" ]; then
        OLD_PID=$(cat "$DAEMON_PID_FILE")
        if kill -0 "$OLD_PID" 2>/dev/null; then
            log "Protection daemon already running (PID: $OLD_PID)"
            return
        else
            rm -f "$DAEMON_PID_FILE"
        fi
    fi

    log "Starting main branch protection daemon..."
    
    (
        while true; do
            "$PROTECTION_SCRIPT" >> "$DAEMON_LOG" 2>&1 || true
            sleep 60
        done
    ) &
    
    DAEMON_PID=$!
    echo "$DAEMON_PID" > "$DAEMON_PID_FILE"
    log "Protection daemon started (PID: $DAEMON_PID)"
}

stop_protection_daemon() {
    if [ -f "$DAEMON_PID_FILE" ]; then
        DAEMON_PID=$(cat "$DAEMON_PID_FILE")
        if kill -0 "$DAEMON_PID" 2>/dev/null; then
            log "Stopping protection daemon (PID: $DAEMON_PID)..."
            kill "$DAEMON_PID"
            rm -f "$DAEMON_PID_FILE"
            log "Protection daemon stopped"
        else
            log "Protection daemon not running"
            rm -f "$DAEMON_PID_FILE"
        fi
    else
        log "No daemon PID file found"
    fi
}

case "${1:-start}" in
    start)
        start_protection_daemon
        ;;
    stop)
        stop_protection_daemon
        ;;
    restart)
        stop_protection_daemon
        sleep 1
        start_protection_daemon
        ;;
    status)
        if [ -f "$DAEMON_PID_FILE" ]; then
            DAEMON_PID=$(cat "$DAEMON_PID_FILE")
            if kill -0 "$DAEMON_PID" 2>/dev/null; then
                log "Protection daemon is running (PID: $DAEMON_PID)"
                exit 0
            else
                log "Protection daemon is not running (stale PID file)"
                exit 1
            fi
        else
            log "Protection daemon is not running"
            exit 1
        fi
        ;;
    *)
        echo "Usage: $0 {start|stop|restart|status}"
        exit 1
        ;;
esac
