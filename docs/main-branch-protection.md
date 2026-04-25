# Main Branch Protection

## Overview

The main branch is protected by an automated cron job that runs every minute to detect and revert any unauthorized changes. This ensures all code changes go through the worktree workflow and CI validation.

## Protection Mechanism

### What Gets Reverted

1. **Uncommitted changes** - Any modified, added, or deleted files
2. **Unpushed commits** - Any commits made directly on main that haven't been pushed to origin

### How It Works

The protection script (`scripts/protect-main-branch.sh`) performs these checks:

1. Verifies current branch is `main`
2. Checks for uncommitted changes via `git diff-index`
3. Checks for unpushed commits by comparing with `origin/main`
4. If violations found, performs `git reset --hard` to revert

All actions are logged to `.git/main-protection.log`.

## Setting Up Cron Job

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
# This will be reverted within 1 minute
cd /Users/rydia/Project/mob.ai/git/Agent-Forge
git checkout main
# ... edit files ...
git add -A && git commit -m "feat: my feature"
# ⚠️ REVERTED BY CRON
```

## Emergency Override

If you need to temporarily disable protection:

```bash
# Remove cron job
crontab -e
# Comment out or delete the protection line

# Re-enable later
crontab -e
# Uncomment the line
```

**Warning**: Only disable for critical emergencies. Re-enable immediately after.

## Troubleshooting

### Protection Not Running

```bash
# Check if cron job exists
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
# Uncommitted changes
git diff-index --quiet HEAD --

# Unpushed commits
git rev-list origin/main..HEAD
```

### Revert Actions

```bash
# Revert uncommitted changes
git reset --hard HEAD
git clean -fd

# Revert unpushed commits
git reset --hard origin/main
```

### Logging

All protection actions are logged with timestamps to `.git/main-protection.log`:

```
[2026-04-25 20:45:01] ⚠️  UNAUTHORIZED CHANGES DETECTED on main branch
[2026-04-25 20:45:01] Uncommitted changes found - reverting all modifications
[2026-04-25 20:45:01] ✅ Main branch restored to last commit
```
