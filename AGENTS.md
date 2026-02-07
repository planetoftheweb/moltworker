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

### Adding a New API Secret (External Service Key)

This is the process for adding a new third-party API key (e.g., X API, YouTube API,
some new service). There are **5 files to touch** and **2 CLI commands** to run.
All steps are required; skipping any one will cause the secret to not reach the bot.

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
| Secret in container but not in bot exec sessions | OpenClaw exec sessions don't inherit gateway env | Write to `/tmp/.x-api-env` in `start-moltbot.sh` |
| Old secret values persist after redeploy | Stale container process not restarted | Env fingerprint mechanism handles this automatically |
| Secret shows as empty after `wrangler secret put` | Non-interactive mode or piping issues | Use interactive prompt (no pipe, no echo) |
| `wrangler tail` exposes secrets in plaintext | Cloudflare's internal `setEnvVars` logging | Be aware; rotate keys after debug sessions |

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
