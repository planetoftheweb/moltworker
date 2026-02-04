# Required Tools Inventory

This file lists all tools that should be installed in the Moltbot container.
The bot can reference this to self-check and report missing tools.

## Core Tools (baked into Docker image)

| Tool | Command | Purpose | Install Command |
|------|---------|---------|-----------------|
| clawdbot | `clawdbot --version` | Moltbot CLI | `npm install -g clawdbot@2026.1.24-3` |
| bird | `bird --version` | Twitter/X CLI | `npm install -g @steipete/bird` |
| node | `node --version` | JavaScript runtime | (in base image) |
| npm | `npm --version` | Package manager | (in base image) |
| pnpm | `pnpm --version` | Fast package manager | `npm install -g pnpm` |
| rsync | `rsync --version` | R2 backup sync | `apt-get install -y rsync` |
| git | `git --version` | Version control | `apt-get install -y git` |
| curl | `curl --version` | HTTP requests | `apt-get install -y curl` |

## Self-Check Commands

The bot can run these to verify tools are working:

```bash
# Quick health check
clawdbot --version && bird --version && echo "Core tools OK"

# Full inventory check
for cmd in clawdbot bird node npm pnpm rsync git curl; do
    if command -v $cmd > /dev/null 2>&1; then
        echo "$cmd: OK"
    else
        echo "$cmd: MISSING"
    fi
done
```

## Bootstrap Status File

After each container start, `/root/clawd/.tools-status` contains:
- Last bootstrap check time
- Any tools that were missing
- Any tools that were reinstalled

The bot should check this file on startup and report any issues.

## Adding New Tools

1. Add to `Dockerfile` (for persistence across restarts)
2. Add to `scripts/bootstrap.sh` (safety net if Dockerfile changes fail)
3. Update this file (so bot knows to check for it)

## Reporting Missing Tools

If a tool is missing, the bot should:
1. Check `.tools-status` for recent bootstrap results
2. Try to reinstall using the install command above
3. Report to the user: "Tool X is missing. I tried to reinstall it. [Success/Failed]"
