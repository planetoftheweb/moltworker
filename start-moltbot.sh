#!/bin/bash
# Startup script for OpenClaw in Cloudflare Sandbox
# This script:
# 1. Restores config from R2 backup if available
# 2. Configures openclaw from environment variables
# 3. Starts a background sync to backup config to R2
# 4. Starts the gateway

set -e

# Check if openclaw gateway is already running - bail early if so
if pgrep -f "openclaw gateway" > /dev/null 2>&1; then
    echo "OpenClaw gateway is already running, exiting."
    exit 0
fi

# ============================================================
# BOOTSTRAP: Check and repair tool installation
# ============================================================
# Safety net to catch any missing tools before the bot starts
BOOTSTRAP_SCRIPT="/usr/local/bin/bootstrap.sh"
if [ -f "$BOOTSTRAP_SCRIPT" ]; then
    echo "Running bootstrap checks..."
    bash "$BOOTSTRAP_SCRIPT" || echo "Bootstrap had issues but continuing..."
else
    echo "Bootstrap script not found, skipping tool checks"
fi

# Paths - openclaw uses ~/.openclaw/ for config
CONFIG_DIR="/root/.openclaw"
CONFIG_FILE="$CONFIG_DIR/openclaw.json"
TEMPLATE_DIR="/root/.openclaw-templates"
TEMPLATE_FILE="$TEMPLATE_DIR/openclaw.json.template"
BACKUP_DIR="/data/moltbot"

echo "Config directory: $CONFIG_DIR"
echo "Backup directory: $BACKUP_DIR"

# Log env vars for debugging
echo "=== Environment Variables ==="
echo "GITHUB_TOKEN: ${GITHUB_TOKEN:+[SET]}"
echo "BRAVE_API_KEY: ${BRAVE_API_KEY:+[SET]}"
echo "ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY:+[SET]}"
echo "TELEGRAM_BOT_TOKEN: ${TELEGRAM_BOT_TOKEN:+[SET]}"
echo "X_BEARER_TOKEN: ${X_BEARER_TOKEN:+[SET]}"
echo "X_CONSUMER_KEY: ${X_CONSUMER_KEY:+[SET]}"
echo "X_CONSUMER_SECRET: ${X_CONSUMER_SECRET:+[SET]}"
echo "PUBLER_API_KEY: ${PUBLER_API_KEY:+[SET]}"
echo "PUBLER_WORKSPACE_ID: ${PUBLER_WORKSPACE_ID:+[SET]}"
echo "============================="

# ============================================================
# WRITE API SECRETS TO TEMP FILE FOR BOT EXEC SESSIONS
# ============================================================
# OpenClaw exec sessions (where the bot runs commands) do NOT inherit
# the gateway process's env vars. So we write API secrets to a file
# that bot skills can `source` before running commands.
#
# IMPORTANT: The heredoc delimiter is UNQUOTED (no quotes around ENVEOF)
# so that ${VAR} gets expanded by the shell at write time.
#
# To add a new API secret:
#   1. Add the export line below
#   2. Add logging above in the "Environment Variables" section
#   3. See AGENTS.md "Adding a New API Secret" for the full checklist
# ============================================================
cat > /tmp/.api-env << ENVEOF
export X_BEARER_TOKEN="${X_BEARER_TOKEN}"
export X_CONSUMER_KEY="${X_CONSUMER_KEY}"
export X_CONSUMER_SECRET="${X_CONSUMER_SECRET}"
export PUBLER_API_KEY="${PUBLER_API_KEY}"
export PUBLER_WORKSPACE_ID="${PUBLER_WORKSPACE_ID}"
ENVEOF
chmod 600 /tmp/.api-env
echo "Wrote API secrets to /tmp/.api-env"

# Create config directory
mkdir -p "$CONFIG_DIR"

# ============================================================
# RESTORE FROM R2 BACKUP
# ============================================================
# Check if R2 backup exists by looking for openclaw.json (or legacy clawdbot.json)
# The BACKUP_DIR may exist but be empty if R2 was just mounted
# Note: backup structure is $BACKUP_DIR/clawdbot/ (legacy) or $BACKUP_DIR/openclaw/ and $BACKUP_DIR/skills/

# Wait for R2 mount to be ready (s3fs can take a moment)
echo "Waiting for R2 mount..."
for i in 1 2 3 4 5; do
    if mount | grep -q "s3fs on $BACKUP_DIR"; then
        echo "R2 mounted successfully"
        ls -la "$BACKUP_DIR/" 2>/dev/null || true
        break
    fi
    echo "R2 not mounted yet, waiting... ($i/5)"
    sleep 2
done

# Debug: show what's in backup dir
echo "=== R2 Backup Contents ==="
ls -la "$BACKUP_DIR/" 2>/dev/null || echo "Cannot list backup dir"
ls -la "$BACKUP_DIR/openclaw/" 2>/dev/null || ls -la "$BACKUP_DIR/clawdbot/" 2>/dev/null || echo "Cannot list config dir"
echo "=========================="

# Helper function to check if R2 backup is newer than local
should_restore_from_r2() {
    local R2_SYNC_FILE="$BACKUP_DIR/.last-sync"
    local LOCAL_SYNC_FILE="$CONFIG_DIR/.last-sync"
    
    # If no R2 sync timestamp, don't restore
    if [ ! -f "$R2_SYNC_FILE" ]; then
        echo "No R2 sync timestamp found, skipping restore"
        return 1
    fi
    
    # If no local sync timestamp, restore from R2
    if [ ! -f "$LOCAL_SYNC_FILE" ]; then
        echo "No local sync timestamp, will restore from R2"
        return 0
    fi
    
    # Compare timestamps
    R2_TIME=$(cat "$R2_SYNC_FILE" 2>/dev/null)
    LOCAL_TIME=$(cat "$LOCAL_SYNC_FILE" 2>/dev/null)
    
    echo "R2 last sync: $R2_TIME"
    echo "Local last sync: $LOCAL_TIME"
    
    # Convert to epoch seconds for comparison
    R2_EPOCH=$(date -d "$R2_TIME" +%s 2>/dev/null || echo "0")
    LOCAL_EPOCH=$(date -d "$LOCAL_TIME" +%s 2>/dev/null || echo "0")
    
    if [ "$R2_EPOCH" -gt "$LOCAL_EPOCH" ]; then
        echo "R2 backup is newer, will restore"
        return 0
    else
        echo "Local data is newer or same, skipping restore"
        return 1
    fi
}

# Try new openclaw path first, then fall back to legacy clawdbot path
if [ -f "$BACKUP_DIR/openclaw/openclaw.json" ]; then
    if should_restore_from_r2; then
        echo "Restoring from R2 backup at $BACKUP_DIR/openclaw..."
        cp -a "$BACKUP_DIR/openclaw/." "$CONFIG_DIR/"
        cp -f "$BACKUP_DIR/.last-sync" "$CONFIG_DIR/.last-sync" 2>/dev/null || true
        echo "Restored config from R2 backup"
    fi
elif [ -f "$BACKUP_DIR/clawdbot/clawdbot.json" ]; then
    # Legacy backup format - migrate to new paths
    if should_restore_from_r2; then
        echo "Restoring from legacy R2 backup at $BACKUP_DIR/clawdbot..."
        cp -a "$BACKUP_DIR/clawdbot/." "$CONFIG_DIR/"
        # Rename config file if needed
        if [ -f "$CONFIG_DIR/clawdbot.json" ] && [ ! -f "$CONFIG_DIR/openclaw.json" ]; then
            mv "$CONFIG_DIR/clawdbot.json" "$CONFIG_DIR/openclaw.json"
        fi
        cp -f "$BACKUP_DIR/.last-sync" "$CONFIG_DIR/.last-sync" 2>/dev/null || true
        echo "Restored and migrated config from legacy R2 backup"
    fi
elif [ -f "$BACKUP_DIR/clawdbot.json" ]; then
    # Very old legacy backup format (flat structure)
    if should_restore_from_r2; then
        echo "Restoring from very old legacy R2 backup at $BACKUP_DIR..."
        cp -a "$BACKUP_DIR/." "$CONFIG_DIR/"
        if [ -f "$CONFIG_DIR/clawdbot.json" ] && [ ! -f "$CONFIG_DIR/openclaw.json" ]; then
            mv "$CONFIG_DIR/clawdbot.json" "$CONFIG_DIR/openclaw.json"
        fi
        cp -f "$BACKUP_DIR/.last-sync" "$CONFIG_DIR/.last-sync" 2>/dev/null || true
        echo "Restored config from very old legacy R2 backup"
    fi
elif [ -d "$BACKUP_DIR" ]; then
    echo "R2 mounted at $BACKUP_DIR but no backup data found yet"
else
    echo "R2 not mounted, starting fresh"
fi

# Restore skills from R2 backup if available (only if R2 is newer)
SKILLS_DIR="/root/clawd/skills"
if [ -d "$BACKUP_DIR/skills" ] && [ "$(ls -A $BACKUP_DIR/skills 2>/dev/null)" ]; then
    if should_restore_from_r2; then
        echo "Restoring skills from $BACKUP_DIR/skills..."
        mkdir -p "$SKILLS_DIR"
        cp -a "$BACKUP_DIR/skills/." "$SKILLS_DIR/"
        echo "Restored skills from R2 backup"
    fi
fi

# ============================================================
# RESTORE WORKSPACE FROM R2 (CRITICAL: Bot memory lives here!)
# ============================================================
# The workspace (/root/clawd/) contains:
# - IDENTITY.md, USER.md (bot personality)
# - memory/ directory (conversation history)
# - Any files the bot creates during conversations
WORKSPACE_DIR="/root/clawd"
if [ -d "$BACKUP_DIR/workspace" ] && [ "$(ls -A $BACKUP_DIR/workspace 2>/dev/null)" ]; then
    echo "=== RESTORING WORKSPACE (BOT MEMORY) ==="
    echo "Found workspace backup at $BACKUP_DIR/workspace"
    ls -la "$BACKUP_DIR/workspace/" 2>/dev/null || true
    mkdir -p "$WORKSPACE_DIR"
    # Use rsync to merge, don't delete local files that might be newer
    rsync -a --no-times "$BACKUP_DIR/workspace/" "$WORKSPACE_DIR/"
    echo "Restored workspace from R2 backup"
    echo "Local workspace now contains:"
    ls -la "$WORKSPACE_DIR/" 2>/dev/null || true
    echo "========================================"
else
    echo "No workspace backup found in R2 - bot will start with fresh memory"
fi

# If config file still doesn't exist, create from template
if [ ! -f "$CONFIG_FILE" ]; then
    echo "No existing config found, initializing from template..."
    if [ -f "$TEMPLATE_FILE" ]; then
        cp "$TEMPLATE_FILE" "$CONFIG_FILE"
    else
        # Create minimal config if template doesn't exist
        cat > "$CONFIG_FILE" << 'EOFCONFIG'
{
  "agents": {
    "defaults": {
      "workspace": "/root/clawd"
    }
  },
  "gateway": {
    "port": 18789,
    "mode": "local"
  }
}
EOFCONFIG
    fi
else
    echo "Using existing config"
fi

# ============================================================
# UPDATE CONFIG FROM ENVIRONMENT VARIABLES
# ============================================================
node << EOFNODE
const fs = require('fs');

const configPath = '/root/.openclaw/openclaw.json';
console.log('Updating config at:', configPath);
let config = {};

try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (e) {
    console.log('Starting with empty config');
}

// Ensure nested objects exist
config.agents = config.agents || {};
config.agents.defaults = config.agents.defaults || {};
config.agents.defaults.model = config.agents.defaults.model || {};
config.gateway = config.gateway || {};
config.channels = config.channels || {};

// Clean up any broken anthropic provider config from previous runs
// (older versions didn't include required 'name' field)
if (config.models?.providers?.anthropic?.models) {
    const hasInvalidModels = config.models.providers.anthropic.models.some(m => !m.name);
    if (hasInvalidModels) {
        console.log('Removing broken anthropic provider config (missing model names)');
        delete config.models.providers.anthropic;
    }
}

// Clean up invalid telegram 'dm' key from previous runs
// (telegram uses 'dmPolicy' at top level, not nested 'dm' object)
if (config.channels?.telegram?.dm !== undefined) {
    console.log('Removing invalid telegram.dm key (use dmPolicy instead)');
    delete config.channels.telegram.dm;
}

// Clean up broken provider configs from R2 backup (invalid api types caused crashes)
if (config.models?.providers?.openrouter) {
    console.log('Removing broken openrouter provider from R2 backup');
    delete config.models.providers.openrouter;
}
if (config.models?.providers?.google) {
    console.log('Removing broken google provider from R2 backup');
    delete config.models.providers.google;
}
if (config.models?.providers?.openai?.api === 'openai-chat') {
    console.log('Removing openai provider with invalid api type');
    delete config.models.providers.openai;
}

// Clean up model aliases for removed providers
if (config.agents?.defaults?.models) {
    Object.keys(config.agents.defaults.models).forEach(k => {
        if (k.startsWith('openrouter/') || k.startsWith('google/')) {
            console.log('Removing model alias:', k);
            delete config.agents.defaults.models[k];
        }
    });
}

// Gateway configuration
config.gateway.port = 18789;
config.gateway.mode = 'local';
config.gateway.trustedProxies = ['10.1.0.0'];

// Set gateway token if provided (check both old and new env var names)
const gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN || process.env.CLAWDBOT_GATEWAY_TOKEN;
if (gatewayToken) {
    config.gateway.auth = config.gateway.auth || {};
    config.gateway.auth.token = gatewayToken;
}

// Allow insecure auth for dev mode (check both old and new env var names)
const devMode = process.env.OPENCLAW_DEV_MODE || process.env.CLAWDBOT_DEV_MODE;
if (devMode === 'true') {
    config.gateway.controlUi = config.gateway.controlUi || {};
    config.gateway.controlUi.allowInsecureAuth = true;
}

// Telegram configuration
if (process.env.TELEGRAM_BOT_TOKEN) {
    config.channels.telegram = config.channels.telegram || {};
    config.channels.telegram.botToken = process.env.TELEGRAM_BOT_TOKEN;
    config.channels.telegram.enabled = true;
    config.channels.telegram.dmPolicy = process.env.TELEGRAM_DM_POLICY || 'pairing';
}

// Discord configuration
if (process.env.DISCORD_BOT_TOKEN) {
    config.channels.discord = config.channels.discord || {};
    config.channels.discord.token = process.env.DISCORD_BOT_TOKEN;
    config.channels.discord.enabled = true;
    config.channels.discord.dm = config.channels.discord.dm || {};
    config.channels.discord.dm.policy = process.env.DISCORD_DM_POLICY || 'pairing';
}

// Slack configuration
if (process.env.SLACK_BOT_TOKEN && process.env.SLACK_APP_TOKEN) {
    config.channels.slack = config.channels.slack || {};
    config.channels.slack.botToken = process.env.SLACK_BOT_TOKEN;
    config.channels.slack.appToken = process.env.SLACK_APP_TOKEN;
    config.channels.slack.enabled = true;
}

// Base URL override (e.g., for Cloudflare AI Gateway)
// Usage: Set AI_GATEWAY_BASE_URL or ANTHROPIC_BASE_URL to your endpoint like:
//   https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}/anthropic
//   https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}/openai
const baseUrl = (process.env.AI_GATEWAY_BASE_URL || process.env.ANTHROPIC_BASE_URL || '').replace(/\/+$/, '');
const isOpenAI = baseUrl.endsWith('/openai');

if (isOpenAI) {
    // Create custom openai provider config with baseUrl override
    console.log('Configuring OpenAI provider with base URL:', baseUrl);
    config.models = config.models || {};
    config.models.providers = config.models.providers || {};
    config.models.providers.openai = {
        baseUrl: baseUrl,
        api: 'openai-responses',
        models: [
            { id: 'gpt-5.2', name: 'GPT-5.2', contextWindow: 200000 },
            { id: 'gpt-5', name: 'GPT-5', contextWindow: 200000 },
            { id: 'gpt-4.5-preview', name: 'GPT-4.5 Preview', contextWindow: 128000 },
        ]
    };
    config.agents.defaults.models = config.agents.defaults.models || {};
    config.agents.defaults.models['openai/gpt-5.2'] = { alias: 'GPT-5.2' };
    config.agents.defaults.models['openai/gpt-5'] = { alias: 'GPT-5' };
    config.agents.defaults.models['openai/gpt-4.5-preview'] = { alias: 'GPT-4.5' };
    config.agents.defaults.model.primary = 'openai/gpt-5.2';
} else if (baseUrl) {
    console.log('Configuring Anthropic provider with base URL:', baseUrl);
    config.models = config.models || {};
    config.models.providers = config.models.providers || {};
    const providerConfig = {
        baseUrl: baseUrl,
        api: 'anthropic-messages',
        models: [
            { id: 'claude-opus-4-6-20260205', name: 'Claude Opus 4.6', contextWindow: 200000 },
            { id: 'claude-opus-4-5-20251101', name: 'Claude Opus 4.5', contextWindow: 200000 },
            { id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5', contextWindow: 200000 },
            { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', contextWindow: 200000 },
        ]
    };
    if (process.env.ANTHROPIC_API_KEY) {
        providerConfig.apiKey = process.env.ANTHROPIC_API_KEY;
    }
    config.models.providers.anthropic = providerConfig;
    config.agents.defaults.models = config.agents.defaults.models || {};
    config.agents.defaults.models['anthropic/claude-opus-4-6-20260205'] = { alias: 'Opus 4.6' };
    config.agents.defaults.models['anthropic/claude-opus-4-5-20251101'] = { alias: 'Opus 4.5' };
    config.agents.defaults.models['anthropic/claude-sonnet-4-5-20250929'] = { alias: 'Sonnet 4.5' };
    config.agents.defaults.models['anthropic/claude-haiku-4-5-20251001'] = { alias: 'Haiku 4.5' };
    config.agents.defaults.model.primary = 'anthropic/claude-sonnet-4-5-20250929';
} else {
    // Default to Anthropic without custom base URL (uses built-in catalog)
    config.agents.defaults.model.primary = 'anthropic/claude-opus-4-5';
}

// Write updated config
fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
console.log('Configuration updated successfully');
console.log('Config:', JSON.stringify(config, null, 2));
EOFNODE

# ============================================================
# START GATEWAY
# ============================================================
# Note: R2 backup sync is handled by the Worker's cron trigger
echo "Starting OpenClaw Gateway..."
echo "Gateway will be available on port 18789"

# Clean up stale lock files
rm -f /tmp/openclaw-gateway.lock 2>/dev/null || true
rm -f "$CONFIG_DIR/gateway.lock" 2>/dev/null || true

BIND_MODE="lan"
GATEWAY_TOKEN="${OPENCLAW_GATEWAY_TOKEN:-$CLAWDBOT_GATEWAY_TOKEN}"
DEV_MODE="${OPENCLAW_DEV_MODE:-$CLAWDBOT_DEV_MODE}"
echo "Dev mode: ${DEV_MODE:-false}, Bind mode: $BIND_MODE"

if [ -n "$GATEWAY_TOKEN" ]; then
    echo "Starting gateway with token auth..."
    exec openclaw gateway --port 18789 --verbose --allow-unconfigured --bind "$BIND_MODE" --token "$GATEWAY_TOKEN"
else
    echo "Starting gateway with device pairing (no token)..."
    exec openclaw gateway --port 18789 --verbose --allow-unconfigured --bind "$BIND_MODE"
fi
