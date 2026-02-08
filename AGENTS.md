# Agent Instructions

Guidelines for AI agents working on this codebase.

## Project Overview

This is a Cloudflare Worker that runs [Moltbot](https://molt.bot/) in a Cloudflare Sandbox container. It provides:
- Proxying to the Moltbot gateway (web UI + WebSocket)
- Admin UI at `/_admin/` for device management
- API endpoints at `/api/*` for device pairing
- Debug endpoints at `/debug/*` for troubleshooting

**Note:** The CLI tool has been renamed from `clawdbot` to `openclaw`. Config paths have changed from `~/.clawdbot/` to `~/.openclaw/`.

## Project Structure

```
src/
├── index.ts          # Main Hono app, route mounting
├── types.ts          # TypeScript type definitions
├── config.ts         # Constants (ports, timeouts, paths)
├── auth/             # Cloudflare Access authentication
│   ├── jwt.ts        # JWT verification
│   ├── jwks.ts       # JWKS fetching and caching
│   └── middleware.ts # Hono middleware for auth
├── gateway/          # Moltbot gateway management
│   ├── process.ts    # Process lifecycle (find, start)
│   ├── env.ts        # Environment variable building
│   ├── r2.ts         # R2 bucket mounting
│   ├── sync.ts       # R2 backup sync logic
│   └── utils.ts      # Shared utilities (waitForProcess)
├── routes/           # API route handlers
│   ├── api.ts        # /api/* endpoints (devices, gateway)
│   ├── admin.ts      # /_admin/* static file serving
│   └── debug.ts      # /debug/* endpoints
└── client/           # React admin UI (Vite)
    ├── App.tsx
    ├── api.ts        # API client
    └── pages/
```

## Key Patterns

### Environment Variables

- `DEV_MODE` - Skips CF Access auth AND bypasses device pairing (maps to `CLAWDBOT_DEV_MODE` for container)
- `DEBUG_ROUTES` - Enables `/debug/*` routes (disabled by default)
- See `src/types.ts` for full `MoltbotEnv` interface

### CLI Commands

When calling the moltbot CLI from the worker, always include `--url ws://localhost:18789`.
When calling the openclaw CLI from the worker:
```typescript
sandbox.startProcess('openclaw devices list --json --url ws://localhost:18789')
```

CLI commands take 10-15 seconds due to WebSocket connection overhead. Use `waitForProcess()` helper in `src/routes/api.ts`.

### Success Detection

The CLI outputs "Approved" (capital A). Use case-insensitive checks:
```typescript
stdout.toLowerCase().includes('approved')
```

## Commands

```bash
npm test              # Run tests (vitest)
npm run test:watch    # Run tests in watch mode
npm run build         # Build worker + client
npm run deploy        # Build and deploy to Cloudflare
npm run dev           # Vite dev server
npm run start         # wrangler dev (local worker)
npm run typecheck     # TypeScript check
```

## Testing

Tests use Vitest. Test files are colocated with source files (`*.test.ts`).

Current test coverage:
- `auth/jwt.test.ts` - JWT decoding and validation
- `auth/jwks.test.ts` - JWKS fetching and caching
- `auth/middleware.test.ts` - Auth middleware behavior
- `gateway/env.test.ts` - Environment variable building
- `gateway/process.test.ts` - Process finding logic
- `gateway/r2.test.ts` - R2 mounting logic

When adding new functionality, add corresponding tests.

## Code Style

- Use TypeScript strict mode
- Prefer explicit types over inference for function signatures
- Keep route handlers thin - extract logic to separate modules
- Use Hono's context methods (`c.json()`, `c.html()`) for responses

## Documentation

- `README.md` - User-facing documentation (setup, configuration, usage)
- `AGENTS.md` - This file, for AI agents

Development documentation goes in AGENTS.md, not README.md.

---

## Architecture

```
Browser
   │
   ▼
┌─────────────────────────────────────┐
│     Cloudflare Worker (index.ts)    │
│  - Starts Moltbot in sandbox        │
│  - Proxies HTTP/WebSocket requests  │
│  - Passes secrets as env vars       │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│     Cloudflare Sandbox Container    │
│  ┌───────────────────────────────┐  │
│  │     Moltbot Gateway           │  │
│  │  - Control UI on port 18789   │  │
│  │  - WebSocket RPC protocol     │  │
│  │  - Agent runtime              │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
```

### Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Worker that manages sandbox lifecycle and proxies requests |
| `Dockerfile` | Container image based on `cloudflare/sandbox` with Node 22 + Moltbot |
| `start-moltbot.sh` | Startup script that configures moltbot from env vars and launches gateway |
| `moltbot.json.template` | Default Moltbot configuration template |
| `wrangler.jsonc` | Cloudflare Worker + Container configuration |

## Local Development

```bash
npm install
cp .dev.vars.example .dev.vars
# Edit .dev.vars with your ANTHROPIC_API_KEY
npm run start
```

### Environment Variables

For local development, create `.dev.vars`:

```bash
ANTHROPIC_API_KEY=sk-ant-...
DEV_MODE=true           # Skips CF Access auth + device pairing
DEBUG_ROUTES=true       # Enables /debug/* routes
```

### WebSocket Limitations

Local development with `wrangler dev` has issues proxying WebSocket connections through the sandbox. HTTP requests work but WebSocket connections may fail. Deploy to Cloudflare for full functionality.

## Docker Image Caching

The Dockerfile includes a cache bust comment. When changing `moltbot.json.template` or `start-moltbot.sh`, bump the version:

```dockerfile
# Build cache bust: 2026-01-26-v10
```

## Gateway Configuration

Moltbot configuration is built at container startup:

1. `moltbot.json.template` is copied to `~/.openclaw/openclaw.json`
2. `start-moltbot.sh` updates the config with values from environment variables
3. Gateway starts with `--allow-unconfigured` flag (skips onboarding wizard)

### Container Environment Variables

These are the env vars passed TO the container (internal names):

| Variable | Config Path | Notes |
|----------|-------------|-------|
| `ANTHROPIC_API_KEY` | (env var) | Moltbot reads directly from env |
| `CLAWDBOT_GATEWAY_TOKEN` | `--token` flag | Mapped from `MOLTBOT_GATEWAY_TOKEN` |
| `CLAWDBOT_DEV_MODE` | `controlUi.allowInsecureAuth` | Mapped from `DEV_MODE` |
| `TELEGRAM_BOT_TOKEN` | `channels.telegram.botToken` | |
| `DISCORD_BOT_TOKEN` | `channels.discord.token` | |
| `SLACK_BOT_TOKEN` | `channels.slack.botToken` | |
| `SLACK_APP_TOKEN` | `channels.slack.appToken` | |

## Moltbot Config Schema

Moltbot has strict config validation. Common gotchas:

- `agents.defaults.model` must be `{ "primary": "model/name" }` not a string
- `gateway.mode` must be `"local"` for headless operation
- No `webchat` channel - the Control UI is served automatically
- `gateway.bind` is not a config option - use `--bind` CLI flag

See [Moltbot docs](https://docs.molt.bot/gateway/configuration) for full schema.

## Common Tasks

### Adding a New API Endpoint

1. Add route handler in `src/routes/api.ts`
2. Add types if needed in `src/types.ts`
3. Update client API in `src/client/api.ts` if frontend needs it
4. Add tests

### Adding a New Environment Variable

1. Add to `MoltbotEnv` interface in `src/types.ts`
2. If passed to container, add to `buildEnvVars()` in `src/gateway/env.ts`
3. Update `.dev.vars.example`
4. Document in README.md secrets table

### Adding a New External API Integration

When integrating a new third-party API (e.g., Publer, YouTube, some new service),
follow this checklist to avoid the mistakes we've made before.

#### Step 1: Verify the API Details (Before Writing Any Code)

1. **Read the official API docs** — find the actual base URL, auth format, and required headers
2. **Verify the domain exists** — run `nslookup <domain>` or `dig <domain>` to confirm DNS resolves
   - Example: `api.publer.io` does NOT exist; the real URL is `app.publer.com/api/v1/`
3. **Test the API locally first** — run a `curl` command from your own machine before touching the bot
4. **Note the auth format exactly** — some APIs use `Bearer <token>`, others use `Bearer-API <token>`,
   or custom header names. Get this from the docs, don't guess.

#### Step 2: Create the Bot Skill

1. Create `skills/<api-name>/SKILL.md` with the correct base URL and auth headers
2. Include a **smoke test command** at the top so the bot can self-verify:
   ```bash
   # Quick test — run this first to verify credentials and connectivity
   source /tmp/.api-env && curl -s \
     -H "Authorization: Bearer $API_KEY" \
     "https://actual-domain.com/api/v1/health-or-simple-endpoint" | jq '.'
   ```
3. Use URLs copied from the official docs, never guessed or remembered
4. Include error handling notes (common HTTP status codes and what they mean)

#### Step 3: Add the Secrets

Choose the right approach based on who needs the secret:

### Adding a New API Secret (External Service Key)

There are **two approaches** for giving the bot access to new API credentials.
Choose based on whether the **Worker** needs the secret or only the **bot** does.

#### Option A: Direct to Bot via Telegram (Simpler — Bot-Only Secrets)

If the secret is **only used by the bot** (not by the Worker itself), the fastest
approach is to message the bot directly via Telegram with the credentials. The bot
stores them in its workspace config, which gets backed up to R2 every 5 minutes and
survives container restarts.

**When to use:** API keys the bot calls via `curl` in skills (e.g., X Access Token,
Publer API key, any third-party API the bot uses directly).

**Pros:** Immediate, no deploy needed, no code changes.
**Cons:** Secrets live in the workspace (backed up to R2, excluded from GitHub backup
via `.gitignore`). Not available to the Worker itself.

**Steps:**
1. Message the bot with the credentials via Telegram
2. Bot stores them in its workspace (e.g., `.env` file, memory, or config)
3. Bot uses them directly — done

#### Option B: Cloudflare Secrets Pipeline (Worker + Bot Secrets)

If the secret is needed by **the Worker** (e.g., for routing, auth middleware, or
container startup logic), or you want encrypted-at-rest storage via Cloudflare, use
the full pipeline. There are **5 files to touch** and **2 CLI commands** to run.
All steps are required; skipping any one will cause the secret to not reach the bot.

**When to use:** Infrastructure secrets (Anthropic API key, Telegram bot token,
CF Access credentials), or any secret the Worker code references in `env.*`.

**Why this is complex:** Cloudflare Workers pass secrets to the Worker `env` object.
The Worker then passes them to the sandbox container via `sandbox.startProcess({ env })`.
But OpenClaw exec sessions (where the bot runs commands) do NOT inherit the gateway
process env vars. So secrets must also be written to a temp file the bot can `source`.

#### Files to Update (in order)

1. **`src/types.ts`** — Add the new key to the `MoltbotEnv` interface:
   ```typescript
   NEW_API_KEY?: string;  // Description of what this key is for
   ```

2. **`src/gateway/env.ts`** — Add to BOTH functions:
   - `buildEnvVars()` — Maps Worker env to container env:
     ```typescript
     if (env.NEW_API_KEY) envVars.NEW_API_KEY = env.NEW_API_KEY;
     ```
   - `getEnvFingerprint()` — Detects when secrets change (triggers container restart):
     ```typescript
     if (env.NEW_API_KEY) keys.push('NEW_API_KEY');
     ```

3. **`start-moltbot.sh`** — Two places to update:
   - **Logging section** (around line 40) — Add status line:
     ```bash
     echo "NEW_API_KEY: ${NEW_API_KEY:+[SET]}"
     ```
   - **Temp env file section** (around line 50) — Add export line inside the heredoc:
     ```bash
     export NEW_API_KEY="${NEW_API_KEY}"
     ```
     > **CRITICAL:** The heredoc delimiter must be UNQUOTED (`<< ENVEOF` not `<< 'ENVEOF'`)
     > so that `${VAR}` gets expanded by the shell at write time.

4. **`wrangler.jsonc`** — Add a comment documenting the secret in the secrets section.

5. **Bot skill file** (e.g., `skills/new-api/SKILL.md`) — Include sourcing instructions:
   ```bash
   source /tmp/.api-env && curl -H "Authorization: Bearer $NEW_API_KEY" ...
   ```
   > All API secrets share `/tmp/.api-env`. When adding a new API, just add export
   > lines to the heredoc block in `start-moltbot.sh`.

#### CLI Commands (after code changes)

1. **Set the secret in Cloudflare:**
   ```bash
   npx wrangler secret put NEW_API_KEY
   # Paste the value when prompted (interactive mode is most reliable)
   ```

2. **Deploy:**
   ```bash
   npm run deploy
   ```
   > **NEVER use `npx wrangler deploy` directly!** It skips `npm run build`, meaning
   > your TypeScript changes won't be compiled and the old code gets deployed.

#### After Deployment

- Wait ~90 seconds for the new container to boot
- The env fingerprint mechanism will detect the new key and restart the process
- Verify via `wrangler tail` or by asking the bot to check

#### Debugging Secrets

```bash
# List all secrets (names only, values are encrypted)
npx wrangler secret list

# Live logs (WARNING: sandbox.setEnvVars logs expose secret values in plaintext!)
npx wrangler tail

# Check env vars from inside the container (if debug routes enabled)
GET /debug/env
```

#### What Can Go Wrong (Lessons Learned)

| Symptom | Cause | Fix |
|---------|-------|-----|
| Secret not in container | Used `npx wrangler deploy` instead of `npm run deploy` | Always use `npm run deploy` |
| Secret in container but not in bot exec sessions | OpenClaw exec sessions don't inherit gateway env | Write to `/tmp/.api-env` in `start-moltbot.sh` |
| Old secret values persist after redeploy | Stale container process not restarted | Env fingerprint mechanism handles this automatically |
| Changed a value but old value persists | Fingerprint only tracks key names, not values | Bump `CACHE_BUST` in Dockerfile to force restart |
| Secret shows as empty after `wrangler secret put` | Non-interactive mode or piping issues | Use interactive prompt (no pipe, no echo) |
| Secret value is the key name, not the actual value | User pasted key name instead of value | Re-run `wrangler secret put` with correct value |
| `wrangler tail` exposes secrets in plaintext | Cloudflare's internal `setEnvVars` logging | Be aware; rotate keys after debug sessions |
| API returns auth error but bot says "DNS issue" | The auth error proves DNS works fine | Check the actual error message, not the bot's diagnosis |
| "Could not resolve host" for an API domain | The domain doesn't exist (NXDOMAIN) | Verify URL from official docs; `nslookup <domain>` to check |
| Bot uses wrong API base URL | Guessed/remembered URL instead of reading docs | Always copy URLs from official API documentation |

#### Debugging Methodology

When the bot reports an API integration isn't working, follow this order:

1. **Check the actual error** — get the exact error message and exit code, not the bot's interpretation
   - curl exit code 6 = DNS failure (domain doesn't exist or can't be resolved)
   - curl exit code 7 = connection refused (host exists but port/service is down)
   - HTTP 401/403 = auth issue (DNS and networking are fine)
   - HTTP 400 = bad request body
2. **Verify the domain exists** — `nslookup <domain>` from your local machine
3. **Verify the secret values** — check what was actually stored, not what was intended
   - Look for the secret value being the key name instead of the actual value
4. **Test from your local machine** — run the same curl command locally
5. **Check the skill file** — make sure URLs match the official API docs

### Debugging

```bash
# View live logs
npx wrangler tail

# Check secrets
npx wrangler secret list
```

Enable debug routes with `DEBUG_ROUTES=true` and check `/debug/processes`.

## R2 Storage Notes

R2 is mounted via s3fs at `/data/moltbot`. Important gotchas:

- **rsync compatibility**: Use `rsync -r --no-times` instead of `rsync -a`. s3fs doesn't support setting timestamps, which causes rsync to fail with "Input/output error".

- **Mount checking**: Don't rely on `sandbox.mountBucket()` error messages to detect "already mounted" state. Instead, check `mount | grep s3fs` to verify the mount status.

- **Never delete R2 data**: The mount directory `/data/moltbot` IS the R2 bucket. Running `rm -rf /data/moltbot/*` will DELETE your backup data. Always check mount status before any destructive operations.

- **Process status**: The sandbox API's `proc.status` may not update immediately after a process completes. Instead of checking `proc.status === 'completed'`, verify success by checking for expected output (e.g., timestamp file exists after sync).

### CRITICAL: R2 Backup Structure

The R2 backup contains THREE directories that MUST ALL be backed up and restored:

| R2 Path | Container Path | Contents | CRITICAL? |
|---------|---------------|----------|-----------|
| `/data/moltbot/openclaw/` | `/root/.openclaw/` | Config, devices, credentials | Yes |
| `/data/moltbot/workspace/` | `/root/clawd/` | **BOT MEMORY** - IDENTITY.md, USER.md, memory/, conversations | **CRITICAL** |
| `/data/moltbot/skills/` | `/root/clawd/skills/` | Custom skills | Yes |

**WARNING: DO NOT remove the workspace backup from `src/gateway/sync.ts` or `start-moltbot.sh`!**

The workspace directory contains the bot's personality, memory, and conversation history. Without it, the bot loses all context on container restart. This has caused data loss multiple times.

There is a test in `src/gateway/sync.test.ts` that verifies workspace is included in backup. This test MUST pass before deploying.

### Verifying Backup Health

Use the debug endpoint to verify backups are working:

```
GET /debug/backup-health
```

This checks:
1. R2 is mounted
2. Config backup exists
3. Workspace backup exists (bot memory)
4. Last sync timestamp
