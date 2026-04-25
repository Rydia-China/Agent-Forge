#!/bin/bash
set -euo pipefail

# Main Branch Protection Script
#
# PURPOSE
#   Force all development to happen in worktree branches by clearing the
#   working directory of main as soon as someone tries to edit files there.
#
# SCOPE — STRICTLY LIMITED
#   This script ONLY reverts uncommitted (dirty) workdir state on main.
#   It MUST NEVER touch commit history.
#
# WHY (history of past incident, do not regress)
#   A previous version of this script also did `git reset --hard origin/main`
#   when it detected "unpushed commits" on main. That logic destroyed legitimate
#   merge commits (worktree branches merged into local main but not yet pushed),
#   wiping out an entire night of work in 36 seconds. See commit history around
#   2026-04-25 and `.git/main-protection.log` for the post-mortem.
#
# RULE
#   - Dirty workdir on main      → revert workdir (this is the goal).
#   - HEAD ahead of origin/main  → DO NOTHING. Pushing is the user's decision.
#
# NOTE
#   `git clean -fd` skips paths matched by .gitignore, so log files and other
#   ignored artifacts (e.g. logs/) are preserved across cleanups.

REPO_DIR="/Users/rydia/Project/mob.ai/git/Agent-Forge"
MAIN_BRANCH="main"
LOG_FILE="$REPO_DIR/.git/main-protection.log"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

cd "$REPO_DIR" || exit 1

# Only act when checked out on main; worktrees are unaffected.
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "$MAIN_BRANCH" ]; then
    log "Not on main branch (current: $CURRENT_BRANCH), skipping protection check"
    exit 0
fi

# Detect dirty workdir (tracked changes OR untracked, non-ignored files).
DIRTY=0
if ! git diff-index --quiet HEAD --; then
    DIRTY=1
fi
if [ -n "$(git ls-files --others --exclude-standard)" ]; then
    DIRTY=1
fi

if [ "$DIRTY" -eq 1 ]; then
    log "⚠️  Dirty workdir on main branch — reverting workdir to force worktree workflow"
    git status --short | tee -a "$LOG_FILE"

    # Revert tracked changes and clean untracked (non-ignored) files.
    # NOTE: this only resets the working tree to HEAD; it never moves HEAD itself.
    git reset --hard HEAD
    git clean -fd

    log "✅ Main branch workdir restored to HEAD"
    exit 0
fi

# IMPORTANT: We intentionally do NOT compare HEAD with origin/main here.
# Local main being ahead of origin/main is legitimate (e.g. just merged a
# worktree branch and pending push). Resetting to origin/main here would
# destroy committed history. See header comment for the incident this avoids.

log "✓ Main branch workdir clean"
