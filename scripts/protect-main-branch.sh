#!/bin/bash
set -euo pipefail

# Main Branch Protection Script
# Runs every minute via cron to detect and revert unauthorized changes to main branch

REPO_DIR="/Users/rydia/Project/mob.ai/git/Agent-Forge"
MAIN_BRANCH="main"
LOG_FILE="$REPO_DIR/.git/main-protection.log"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

cd "$REPO_DIR" || exit 1

# Check if we're on main branch
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "$MAIN_BRANCH" ]; then
    log "Not on main branch (current: $CURRENT_BRANCH), skipping protection check"
    exit 0
fi

# Check for uncommitted changes
if ! git diff-index --quiet HEAD --; then
    log "⚠️  UNAUTHORIZED CHANGES DETECTED on main branch"
    log "Uncommitted changes found - reverting all modifications"
    
    # Show what's being reverted
    git status --short | tee -a "$LOG_FILE"
    
    # Revert all changes
    git reset --hard HEAD
    git clean -fd
    
    log "✅ Main branch restored to last commit"
    exit 0
fi

# Check if HEAD is ahead of origin/main (unpushed commits)
git fetch origin "$MAIN_BRANCH" --quiet

LOCAL_COMMIT=$(git rev-parse HEAD)
REMOTE_COMMIT=$(git rev-parse origin/"$MAIN_BRANCH")

if [ "$LOCAL_COMMIT" != "$REMOTE_COMMIT" ]; then
    # Check if local is ahead
    if git merge-base --is-ancestor "$REMOTE_COMMIT" "$LOCAL_COMMIT"; then
        # Local is ahead - check if these commits passed CI
        UNPUSHED_COMMITS=$(git rev-list origin/"$MAIN_BRANCH"..HEAD)
        
        log "⚠️  UNAUTHORIZED COMMITS DETECTED on main branch"
        log "Found unpushed commits:"
        git log origin/"$MAIN_BRANCH"..HEAD --oneline | tee -a "$LOG_FILE"
        
        # Check if the latest commit has a CI pass marker
        # (In real implementation, this would check GitHub Actions status)
        # For now, we assume any unpushed commit on main is unauthorized
        
        log "Resetting main branch to origin/main"
        git reset --hard origin/"$MAIN_BRANCH"
        
        log "✅ Main branch restored to last CI-verified commit"
        exit 0
    fi
fi

log "✓ Main branch is clean and synchronized"
