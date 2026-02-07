import type { Sandbox } from '@cloudflare/sandbox';
import type { MoltbotEnv } from '../types';
import { R2_MOUNT_PATH } from '../config';
import { mountR2Storage } from './r2';
import { waitForProcess } from './utils';

export interface SyncResult {
  success: boolean;
  lastSync?: string;
  error?: string;
  details?: string;
  repoUrl?: string;
}

// GitHub repo for secondary backup
const GITHUB_BACKUP_REPO = 'planetoftheweb/moltbot-memory-backup';
const BACKUP_REPO_DIR = '/tmp/moltbot-backup-repo';

/**
 * Sync moltbot config, workspace, and skills from container to R2 for persistence.
 * 
 * This function:
 * 1. Mounts R2 if not already mounted
 * 2. Verifies source has critical files (prevents overwriting good backup with empty data)
 * 3. Runs rsync to copy config, workspace, and skills to R2
 * 4. Writes a timestamp file for tracking
 * 
 * CRITICAL: The workspace directory (/root/clawd/) contains the bot's memory!
 * This includes IDENTITY.md, USER.md, memory/, and all conversation context.
 * Without backing it up, the bot loses all context on container restart.
 * DO NOT REMOVE the workspace backup!
 * 
 * @param sandbox - The sandbox instance
 * @param env - Worker environment bindings
 * @returns SyncResult with success status and optional error details
 */
export async function syncToR2(sandbox: Sandbox, env: MoltbotEnv): Promise<SyncResult> {
  // Check if R2 is configured
  if (!env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY || !env.CF_ACCOUNT_ID) {
    return { success: false, error: 'R2 storage is not configured' };
  }

  // Mount R2 if not already mounted
  const mounted = await mountR2Storage(sandbox, env);
  if (!mounted) {
    return { success: false, error: 'Failed to mount R2 storage' };
  }

  // Sanity check: verify source has critical files before syncing
  // This prevents accidentally overwriting a good backup with empty/corrupted data
  try {
    const checkProc = await sandbox.startProcess('(test -f /root/.openclaw/openclaw.json || test -f /root/.clawdbot/clawdbot.json) && echo "ok"');
    await waitForProcess(checkProc, 5000);
    const checkLogs = await checkProc.getLogs();
    if (!checkLogs.stdout?.includes('ok')) {
      return { 
        success: false, 
        error: 'Sync aborted: source missing config file',
        details: 'The local config directory is missing critical files. This could indicate corruption or an incomplete setup.',
      };
    }
  } catch (err) {
    return { 
      success: false, 
      error: 'Failed to verify source files',
      details: err instanceof Error ? err.message : 'Unknown error',
    };
  }

  // Run rsync to backup config, workspace, and skills to R2
  // Note: Use --no-times because s3fs doesn't support setting timestamps
  // CRITICAL: The workspace (/root/clawd/) contains the bot's memory!
  // This includes IDENTITY.md, USER.md, memory/, and all conversation context.
  // DO NOT REMOVE the workspace backup - it's the bot's persistent memory!
  // Sync from openclaw path (or legacy clawdbot path) to R2
  // Note: We sync to openclaw/ in R2 for new backups, but restore checks both paths
  const syncCmd = `rsync -r --no-times --delete --exclude='*.lock' --exclude='*.log' --exclude='*.tmp' --exclude='node_modules' /root/.openclaw/ ${R2_MOUNT_PATH}/openclaw/ 2>/dev/null || rsync -r --no-times --delete --exclude='*.lock' --exclude='*.log' --exclude='*.tmp' --exclude='node_modules' /root/.clawdbot/ ${R2_MOUNT_PATH}/clawdbot/ && rsync -r --no-times --delete --exclude='*.lock' --exclude='*.log' --exclude='*.tmp' --exclude='node_modules' --exclude='.git' /root/clawd/ ${R2_MOUNT_PATH}/workspace/ && date -Iseconds > ${R2_MOUNT_PATH}/.last-sync`;
  
  try {
    const proc = await sandbox.startProcess(syncCmd);
    await waitForProcess(proc, 30000); // 30 second timeout for sync

    // Check for success by reading the timestamp file
    // (process status may not update reliably in sandbox API)
    const timestampProc = await sandbox.startProcess(`cat ${R2_MOUNT_PATH}/.last-sync`);
    await waitForProcess(timestampProc, 5000);
    const timestampLogs = await timestampProc.getLogs();
    const lastSync = timestampLogs.stdout?.trim();
    
    if (lastSync && lastSync.match(/^\d{4}-\d{2}-\d{2}/)) {
      return { success: true, lastSync };
    } else {
      const logs = await proc.getLogs();
      return {
        success: false,
        error: 'Sync failed',
        details: logs.stderr || logs.stdout || 'No timestamp file created',
      };
    }
  } catch (err) {
    return { 
      success: false, 
      error: 'Sync error',
      details: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

/**
 * Backup bot memory to a private GitHub repository as a secondary backup.
 * This provides a visible, verifiable backup outside of Cloudflare with full git history.
 * 
 * Files backed up:
 * - IDENTITY.md (bot personality)
 * - USER.md (user info)  
 * - memory/ directory (conversation memory files)
 * - config/ directory (openclaw config)
 * - workspace files
 * 
 * Each backup is a commit, so you get full history of all changes.
 * 
 * @param sandbox - The sandbox instance
 * @param env - Worker environment bindings (needs GITHUB_TOKEN)
 * @returns SyncResult with repo URL on success
 */
export async function syncToGitHub(sandbox: Sandbox, env: MoltbotEnv): Promise<SyncResult> {
  if (!env.GITHUB_TOKEN) {
    return { success: false, error: 'GITHUB_TOKEN not configured' };
  }

  const timestamp = new Date().toISOString();
  const repoUrl = `https://github.com/${GITHUB_BACKUP_REPO}`;

  try {
    // Setup git and clone/pull the backup repo
    const setupCmd = `
      # Configure git
      git config --global user.email "moltbot@backup.local"
      git config --global user.name "Moltbot Backup"
      
      # Clone or pull the repo
      if [ -d "${BACKUP_REPO_DIR}/.git" ]; then
        cd ${BACKUP_REPO_DIR} && git pull origin main 2>/dev/null || true
      else
        rm -rf ${BACKUP_REPO_DIR}
        git clone https://x-access-token:${env.GITHUB_TOKEN}@github.com/${GITHUB_BACKUP_REPO}.git ${BACKUP_REPO_DIR} 2>&1 || mkdir -p ${BACKUP_REPO_DIR}
        cd ${BACKUP_REPO_DIR}
        if [ ! -d ".git" ]; then
          git init
          git remote add origin https://x-access-token:${env.GITHUB_TOKEN}@github.com/${GITHUB_BACKUP_REPO}.git
        fi
      fi
      echo "SETUP_OK"
    `;
    
    const setupProc = await sandbox.startProcess(setupCmd);
    await waitForProcess(setupProc, 30000);
    const setupLogs = await setupProc.getLogs();
    
    if (!setupLogs.stdout?.includes('SETUP_OK')) {
      return {
        success: false,
        error: 'Failed to setup git repo',
        details: setupLogs.stderr || setupLogs.stdout || '',
      };
    }

    // Copy files to the backup repo
    const copyCmd = `
      cd ${BACKUP_REPO_DIR}
      
      # Create .gitignore to prevent secrets from being committed
      cat > .gitignore << 'GIEOF'
# Sensitive files - never commit these
.env
.env.*
*.secrets
.x-api-env
.api-env
*.key
*.pem
**/credentials/
**/exec-approvals.json
load-env.sh
**/load-env.sh
GIEOF
      
      # Create directories
      mkdir -p workspace config
      
      # Copy workspace (bot memory)
      cp -r /root/clawd/* workspace/ 2>/dev/null || true
      
      # Remove any sensitive files that were copied
      rm -f workspace/.env workspace/.env.* workspace/load-env.sh 2>/dev/null || true
      
      # Copy config
      cp -r /root/.openclaw/* config/ 2>/dev/null || cp -r /root/.clawdbot/* config/ 2>/dev/null || true
      
      # Remove sensitive data from config backup
      if [ -f config/openclaw.json ]; then
        cat config/openclaw.json | sed 's/"token":[^,}]*/"token":"[REDACTED]"/g' | sed 's/"apiKey":[^,}]*/"apiKey":"[REDACTED]"/g' | sed 's/"botToken":[^,}]*/"botToken":"[REDACTED]"/g' > config/openclaw.json.tmp
        mv config/openclaw.json.tmp config/openclaw.json
      elif [ -f config/clawdbot.json ]; then
        cat config/clawdbot.json | sed 's/"token":[^,}]*/"token":"[REDACTED]"/g' | sed 's/"apiKey":[^,}]*/"apiKey":"[REDACTED]"/g' | sed 's/"botToken":[^,}]*/"botToken":"[REDACTED]"/g' > config/clawdbot.json.tmp
        mv config/clawdbot.json.tmp config/clawdbot.json
      fi
      
      # Remove sensitive config files
      rm -f config/credentials/* 2>/dev/null || true
      rm -f config/exec-approvals.json 2>/dev/null || true
      
      # Create timestamp file
      echo "Last backup: ${timestamp}" > BACKUP_TIMESTAMP.txt
      
      # Create README if it doesn't exist
      if [ ! -f README.md ]; then
        echo "# Moltbot Memory Backup" > README.md
        echo "" >> README.md
        echo "Automated backup of Moltbot memory and configuration." >> README.md
        echo "" >> README.md
        echo "## Contents" >> README.md
        echo "- \\\`workspace/\\\` - Bot memory (IDENTITY.md, USER.md, memory/)" >> README.md
        echo "- \\\`config/\\\` - Moltbot configuration" >> README.md
        echo "- \\\`BACKUP_TIMESTAMP.txt\\\` - Last backup time" >> README.md
      fi
      
      echo "COPY_OK"
    `;
    
    const copyProc = await sandbox.startProcess(copyCmd);
    await waitForProcess(copyProc, 15000);
    const copyLogs = await copyProc.getLogs();
    
    if (!copyLogs.stdout?.includes('COPY_OK')) {
      return {
        success: false,
        error: 'Failed to copy files',
        details: copyLogs.stderr || copyLogs.stdout || '',
      };
    }

    // Commit and push
    const pushCmd = `
      cd ${BACKUP_REPO_DIR}
      
      # Add all files
      git add -A
      
      # Check if there are changes to commit
      if git diff --staged --quiet; then
        echo "NO_CHANGES"
      else
        git commit -m "Backup: ${timestamp}"
        git branch -M main
        git push -u origin main 2>&1
        echo "PUSH_OK"
      fi
    `;
    
    const pushProc = await sandbox.startProcess(pushCmd);
    await waitForProcess(pushProc, 30000);
    const pushLogs = await pushProc.getLogs();
    const pushOutput = pushLogs.stdout || '';
    
    if (pushOutput.includes('NO_CHANGES')) {
      return { 
        success: true, 
        lastSync: timestamp, 
        repoUrl,
        details: 'No changes to backup',
      };
    }
    
    if (pushOutput.includes('PUSH_OK') || pushOutput.includes('main -> main')) {
      return { success: true, lastSync: timestamp, repoUrl };
    } else {
      return {
        success: false,
        error: 'Failed to push to GitHub',
        details: pushLogs.stderr || pushOutput,
      };
    }
    
  } catch (err) {
    return {
      success: false,
      error: 'GitHub sync error',
      details: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

// Keep the old function name as alias for backwards compatibility
export const syncToGist = syncToGitHub;
