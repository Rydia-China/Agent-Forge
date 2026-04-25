# Main Branch Protection

## Overview

The main branch is protected by an automated daemon that runs every minute to revert any **uncommitted (dirty) changes** on main. This forces all development to happen in worktree branches.

> **Strict scope**: the daemon ONLY cleans the working directory on main. It will **never** touch commit history (no `git reset --hard origin/main`, no rewriting commits). A previous version of this script destroyed legitimate merge commits when it tried to "revert unpushed commits" — that behavior has been permanently removed. See the comment block at the top of `scripts/protect-main-branch.sh` for the full post-mortem.

## Quick Start

The easiest way to enable protection is to use the `dev-full.sh` script, which automatically starts the protection daemon alongside the Next.js dev server:

```bash
./scripts/dev-full.sh
```

This will:
1. Start the main branch protection daemon (checks every 60 seconds)
2. Start the Next.js development server
3. Automatically stop the daemon when you exit (Ctrl+C)

### Manual Daemon Control

You can also control the protection daemon independently:

```bash
# Start daemon
./scripts/protection-daemon.sh start

# Stop daemon
./scripts/protection-daemon.sh stop

# Restart daemon
./scripts/protection-daemon.sh restart

# Check status
./scripts/protection-daemon.sh status
```

## Protection Mechanism

### What Gets Reverted

**Only uncommitted changes** — any modified, added, or deleted files (tracked or untracked, except gitignored paths) in the main workspace are reverted.

### What Is NEVER Touched

- Commit history on main (committed work, including unpushed merge commits)
- Any worktree branch (`agent/*`) or its working directory
- Anything when HEAD is not on `main`
- Files matched by `.gitignore` (e.g. `logs/`, `.env`, build artifacts)

### How It Works

The protection script (`scripts/protect-main-branch.sh`) performs these checks:

1. Verifies current branch is `main` (otherwise exits cleanly)
2. Detects dirty workdir via `git diff-index` and `git ls-files --others --exclude-standard`
3. If dirty: runs `git reset --hard HEAD` and `git clean -fd` (workdir only, HEAD never moves)

All actions are logged to `.git/main-protection.log`.

## Alternative: System Cron Job (Optional)

If you prefer to run protection independently of the dev server, you can set up a system cron job:

### macOS

```bash
# Edit crontab
crontab -e

# Add this line (runs every minute)
* * * * * /Users/rydia/Project/mob.ai/git/Agent-Forge/scripts/protect-main-branch.sh >> /Users/rydia/Project/mob.ai/git/Agent-Forge/.git/cron.log 2>&1
```

### Linux

```bash
# Edit crontab
crontab -e

# Add this line (adjust path to your repo)
* * * * * /path/to/Agent-Forge/scripts/protect-main-branch.sh >> /path/to/Agent-Forge/.git/cron.log 2>&1
```

### Verify Cron Job

```bash
# List active cron jobs
crontab -l

# Check protection log
tail -f .git/main-protection.log

# Check cron execution log
tail -f .git/cron.log
```

**Note**: Using `dev-full.sh` is recommended as it automatically manages the daemon lifecycle.

## Correct Workflow

### ✅ Correct: Use Worktree

```bash
# Create worktree
git worktree add .agent-worktrees/my-feature -b agent/my-feature

# Work in worktree
cd .agent-worktrees/my-feature
# ... make changes ...
git add -A && git commit -m "feat: my feature"
git push -u origin agent/my-feature

# After CI passes, merge in main workspace
cd /Users/rydia/Project/mob.ai/git/Agent-Forge
git checkout main
git merge --no-ff agent/my-feature
git push

# Cleanup
git worktree remove .agent-worktrees/my-feature
git branch -d agent/my-feature
```

### ❌ Wrong: Direct Edit on Main

```bash
# Editing files directly on main — the dirty workdir will be wiped within 1 minute
cd /Users/rydia/Project/mob.ai/git/Agent-Forge
git checkout main
# ... edit files ...
# ⚠️ WORKDIR REVERTED BY DAEMON before you get to commit
```

> Note: if you do manage to commit on main before the daemon runs, the **commit will not be reverted** (the daemon never touches history). But that still violates the worktree-only rule — use `git reset --soft HEAD~1` and move the change into a worktree branch.

## Emergency Override

If you need to temporarily disable protection:

```bash
# Stop the daemon
./scripts/protection-daemon.sh stop

# Or if using cron, remove the cron job
crontab -e
# Comment out or delete the protection line

# Re-enable later
./scripts/protection-daemon.sh start
# Or uncomment the cron line
```

**Warning**: Only disable for critical emergencies. Re-enable immediately after.

## Troubleshooting

### Protection Not Running

```bash
# Check daemon status
./scripts/protection-daemon.sh status

# Check if daemon process exists
ps aux | grep protect-main-branch

# Check daemon log
tail -f .git/protection-daemon.log

# Check protection log
tail -f .git/main-protection.log

# If using cron, check if cron job exists
crontab -l | grep protect-main-branch

# Check cron service status (macOS)
sudo launchctl list | grep cron

# Check cron service status (Linux)
systemctl status cron
```

### False Positives

If protection triggers incorrectly:

1. Check `.git/main-protection.log` for details
2. Verify you're following the worktree workflow
3. Ensure `origin/main` is up to date: `git fetch origin main`

### Script Errors

```bash
# Test script manually
./scripts/protect-main-branch.sh

# Check for syntax errors
bash -n scripts/protect-main-branch.sh
```

## Implementation Details

### Detection Logic

```bash
# Tracked changes
git diff-index --quiet HEAD --

# Untracked (non-ignored) files
git ls-files --others --exclude-standard
```

### Revert Actions

```bash
# Revert uncommitted changes (workdir only — HEAD never moves; gitignored paths are preserved)
git reset --hard HEAD
git clean -fd
```

There is **no** code path that resets HEAD to `origin/main` or otherwise rewrites commit history. This is intentional and load-bearing.

### Logging

All protection actions are logged with timestamps to `.git/main-protection.log`:

```
[2026-04-25 20:45:01] ⚠️  Dirty workdir on main branch — reverting workdir to force worktree workflow
[2026-04-25 20:45:01] ✅ Main branch workdir restored to HEAD
```
