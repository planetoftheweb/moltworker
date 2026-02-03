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
  gistUrl?: string;
}

// Gist ID is stored in the container to track the backup gist
const GIST_ID_FILE = '/root/.clawdbot/.backup-gist-id';

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
    const checkProc = await sandbox.startProcess('test -f /root/.clawdbot/clawdbot.json && echo "ok"');
    await waitForProcess(checkProc, 5000);
    const checkLogs = await checkProc.getLogs();
    if (!checkLogs.stdout?.includes('ok')) {
      return { 
        success: false, 
        error: 'Sync aborted: source missing clawdbot.json',
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
  const syncCmd = `rsync -r --no-times --delete --exclude='*.lock' --exclude='*.log' --exclude='*.tmp' --exclude='node_modules' /root/.clawdbot/ ${R2_MOUNT_PATH}/clawdbot/ && rsync -r --no-times --delete --exclude='*.lock' --exclude='*.log' --exclude='*.tmp' --exclude='node_modules' --exclude='.git' /root/clawd/ ${R2_MOUNT_PATH}/workspace/ && date -Iseconds > ${R2_MOUNT_PATH}/.last-sync`;
  
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
 * Backup bot memory to a private GitHub gist as a secondary backup.
 * This provides a visible, verifiable backup outside of Cloudflare.
 * 
 * Files backed up:
 * - IDENTITY.md (bot personality)
 * - USER.md (user info)
 * - memory/*.md (conversation memory files)
 * - clawdbot.json (config)
 * 
 * @param sandbox - The sandbox instance
 * @param env - Worker environment bindings (needs GITHUB_TOKEN)
 * @returns SyncResult with gist URL on success
 */
export async function syncToGist(sandbox: Sandbox, env: MoltbotEnv): Promise<SyncResult> {
  if (!env.GITHUB_TOKEN) {
    return { success: false, error: 'GITHUB_TOKEN not configured' };
  }

  try {
    // Read memory files from container
    const readFilesCmd = `
      echo "===IDENTITY.md===" && cat /root/clawd/IDENTITY.md 2>/dev/null || echo "(empty)" &&
      echo "===USER.md===" && cat /root/clawd/USER.md 2>/dev/null || echo "(empty)" &&
      echo "===MEMORY_FILES===" && find /root/clawd/memory -name "*.md" -type f 2>/dev/null | head -20 &&
      echo "===CONFIG===" && cat /root/.clawdbot/clawdbot.json 2>/dev/null | head -100 &&
      echo "===GIST_ID===" && cat ${GIST_ID_FILE} 2>/dev/null || echo ""
    `;
    
    const readProc = await sandbox.startProcess(readFilesCmd);
    await waitForProcess(readProc, 10000);
    const readLogs = await readProc.getLogs();
    const output = readLogs.stdout || '';
    
    // Parse the output
    const identityMatch = output.match(/===IDENTITY\.md===\n([\s\S]*?)(?=\n===USER\.md===)/);
    const userMatch = output.match(/===USER\.md===\n([\s\S]*?)(?=\n===MEMORY_FILES===)/);
    const memoryFilesMatch = output.match(/===MEMORY_FILES===\n([\s\S]*?)(?=\n===CONFIG===)/);
    const configMatch = output.match(/===CONFIG===\n([\s\S]*?)(?=\n===GIST_ID===)/);
    const gistIdMatch = output.match(/===GIST_ID===\n(.*)$/);
    
    const identity = identityMatch?.[1]?.trim() || '(empty)';
    const user = userMatch?.[1]?.trim() || '(empty)';
    const memoryFiles = memoryFilesMatch?.[1]?.trim() || '';
    const config = configMatch?.[1]?.trim() || '{}';
    const existingGistId = gistIdMatch?.[1]?.trim() || '';
    
    // Read individual memory files if they exist
    let memoryContent = '';
    if (memoryFiles && memoryFiles !== '') {
      const files = memoryFiles.split('\n').filter(f => f.trim());
      for (const file of files.slice(0, 10)) { // Limit to 10 files
        const catProc = await sandbox.startProcess(`echo "### ${file}" && cat "${file}" 2>/dev/null`);
        await waitForProcess(catProc, 3000);
        const catLogs = await catProc.getLogs();
        memoryContent += (catLogs.stdout || '') + '\n\n';
      }
    }
    
    // Build gist payload
    const timestamp = new Date().toISOString();
    const gistFiles: Record<string, { content: string }> = {
      'IDENTITY.md': { content: identity },
      'USER.md': { content: user },
      'config.json': { content: config },
      'backup-timestamp.txt': { content: `Last backup: ${timestamp}` },
    };
    
    if (memoryContent.trim()) {
      gistFiles['memory-files.md'] = { content: memoryContent };
    }
    
    // Create or update gist
    const gistPayload = JSON.stringify({
      description: `Moltbot Memory Backup - ${timestamp}`,
      public: false,
      files: gistFiles,
    });
    
    let gistUrl = '';
    
    if (existingGistId) {
      // Update existing gist
      const updateCmd = `curl -s -X PATCH \
        -H "Authorization: token ${env.GITHUB_TOKEN}" \
        -H "Accept: application/vnd.github.v3+json" \
        -d '${gistPayload.replace(/'/g, "'\\''")}' \
        "https://api.github.com/gists/${existingGistId}"`;
      
      const updateProc = await sandbox.startProcess(updateCmd);
      await waitForProcess(updateProc, 15000);
      const updateLogs = await updateProc.getLogs();
      
      try {
        const response = JSON.parse(updateLogs.stdout || '{}');
        gistUrl = response.html_url || '';
      } catch {
        // If update fails, create new
      }
    }
    
    if (!gistUrl) {
      // Create new gist
      const createCmd = `curl -s -X POST \
        -H "Authorization: token ${env.GITHUB_TOKEN}" \
        -H "Accept: application/vnd.github.v3+json" \
        -d '${gistPayload.replace(/'/g, "'\\''")}' \
        "https://api.github.com/gists"`;
      
      const createProc = await sandbox.startProcess(createCmd);
      await waitForProcess(createProc, 15000);
      const createLogs = await createProc.getLogs();
      
      try {
        const response = JSON.parse(createLogs.stdout || '{}');
        gistUrl = response.html_url || '';
        const gistId = response.id || '';
        
        if (gistId) {
          // Save gist ID for future updates
          await sandbox.startProcess(`echo "${gistId}" > ${GIST_ID_FILE}`);
        }
      } catch (e) {
        return {
          success: false,
          error: 'Failed to parse gist response',
          details: createLogs.stdout || createLogs.stderr || '',
        };
      }
    }
    
    if (gistUrl) {
      return { success: true, gistUrl, lastSync: timestamp };
    } else {
      return { success: false, error: 'Failed to create/update gist' };
    }
    
  } catch (err) {
    return {
      success: false,
      error: 'Gist sync error',
      details: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}
