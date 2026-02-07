import type { Sandbox, Process } from '@cloudflare/sandbox';
import type { MoltbotEnv } from '../types';
import { MOLTBOT_PORT, STARTUP_TIMEOUT_MS } from '../config';
import { buildEnvVars, getEnvFingerprint } from './env';
import { mountR2Storage } from './r2';

// File inside the container that stores the env fingerprint of the running process
const ENV_FINGERPRINT_FILE = '/tmp/.env-fingerprint';

/**
 * Find an existing Moltbot gateway process
 * 
 * @param sandbox - The sandbox instance
 * @returns The process if found and running/starting, null otherwise
 */
export async function findExistingMoltbotProcess(sandbox: Sandbox): Promise<Process | null> {
  try {
    const processes = await sandbox.listProcesses();
    for (const proc of processes) {
      // Only match the gateway process, not CLI commands like "openclaw devices list"
      const isGatewayProcess = 
        proc.command.includes('start-moltbot.sh') ||
        proc.command.includes('openclaw gateway') ||
        proc.command.includes('clawdbot gateway'); // legacy
      const isCliCommand = 
        proc.command.includes('openclaw devices') ||
        proc.command.includes('openclaw --version') ||
        proc.command.includes('clawdbot devices') || // legacy
        proc.command.includes('clawdbot --version'); // legacy
      
      if (isGatewayProcess && !isCliCommand) {
        if (proc.status === 'starting' || proc.status === 'running') {
          return proc;
        }
      }
    }
  } catch (e) {
    console.log('Could not list processes:', e);
  }
  return null;
}

/**
 * Ensure the Moltbot gateway is running
 * 
 * This will:
 * 1. Mount R2 storage if configured
 * 2. Check for an existing gateway process
 * 3. Wait for it to be ready, or start a new one
 * 
 * @param sandbox - The sandbox instance
 * @param env - Worker environment bindings
 * @returns The running gateway process
 */
export async function ensureMoltbotGateway(sandbox: Sandbox, env: MoltbotEnv): Promise<Process> {
  // Mount R2 storage for persistent data (non-blocking if not configured)
  // R2 is used as a backup - the startup script will restore from it on boot
  await mountR2Storage(sandbox, env);

  // Always set env vars at sandbox level so they're available to all future commands.
  // This is a belt-and-suspenders approach: even if the process-level env vars fail,
  // sandbox-level vars are available.
  const envVars = buildEnvVars(env);
  try {
    await sandbox.setEnvVars(envVars);
  } catch (e) {
    console.log('Failed to set sandbox-level env vars (non-fatal):', e);
  }

  // Compute fingerprint of current env var keys to detect changes
  // (e.g., after `wrangler secret put` + redeploy)
  const currentFingerprint = getEnvFingerprint(env);

  // Check if Moltbot is already running or starting
  const existingProcess = await findExistingMoltbotProcess(sandbox);
  if (existingProcess) {
    console.log('Found existing Moltbot process:', existingProcess.id, 'status:', existingProcess.status);

    // Check if env vars have changed since this process was started.
    // If secrets were added/removed, the old process won't have them.
    let envChanged = false;
    try {
      const result = await sandbox.exec(`cat ${ENV_FINGERPRINT_FILE}`);
      const storedFingerprint = (result.stdout || '').trim();
      if (storedFingerprint !== currentFingerprint) {
        console.log('[Gateway] Environment changed! Old:', storedFingerprint, 'New:', currentFingerprint);
        envChanged = true;
      }
    } catch {
      // File doesn't exist (first run or container reset) - treat as changed
      console.log('[Gateway] No env fingerprint found, will restart process');
      envChanged = true;
    }

    if (envChanged) {
      console.log('[Gateway] Killing old process to apply new environment variables...');
      try {
        await existingProcess.kill();
      } catch (killError) {
        console.log('Failed to kill process:', killError);
      }
      // Fall through to start a new process below
    } else {
      // Env vars haven't changed - try to use existing process
      try {
        console.log('Waiting for Moltbot gateway on port', MOLTBOT_PORT, 'timeout:', STARTUP_TIMEOUT_MS);
        await existingProcess.waitForPort(MOLTBOT_PORT, { mode: 'tcp', timeout: STARTUP_TIMEOUT_MS });
        console.log('Moltbot gateway is reachable');
        return existingProcess;
      } catch (e) {
        // Timeout waiting for port - process is likely dead or stuck, kill and restart
        console.log('Existing process not reachable after full timeout, killing and restarting...');
        try {
          await existingProcess.kill();
        } catch (killError) {
          console.log('Failed to kill process:', killError);
        }
      }
    }
  }

  // Start a new Moltbot gateway
  console.log('Starting new Moltbot gateway...');
  const command = '/usr/local/bin/start-moltbot.sh';

  console.log('Starting process with command:', command);
  console.log('Environment vars being passed:', Object.keys(envVars));

  // Write env fingerprint so we can detect changes on next request
  try {
    await sandbox.exec(`echo '${currentFingerprint}' > ${ENV_FINGERPRINT_FILE}`);
  } catch (e) {
    console.log('Failed to write env fingerprint (non-fatal):', e);
  }

  let process: Process;
  try {
    process = await sandbox.startProcess(command, {
      env: Object.keys(envVars).length > 0 ? envVars : undefined,
    });
    console.log('Process started with id:', process.id, 'status:', process.status);
  } catch (startErr) {
    console.error('Failed to start process:', startErr);
    throw startErr;
  }

  // Wait for the gateway to be ready
  try {
    console.log('[Gateway] Waiting for Moltbot gateway to be ready on port', MOLTBOT_PORT);
    await process.waitForPort(MOLTBOT_PORT, { mode: 'tcp', timeout: STARTUP_TIMEOUT_MS });
    console.log('[Gateway] Moltbot gateway is ready!');

    const logs = await process.getLogs();
    if (logs.stdout) console.log('[Gateway] stdout:', logs.stdout);
    if (logs.stderr) console.log('[Gateway] stderr:', logs.stderr);
  } catch (e) {
    console.error('[Gateway] waitForPort failed:', e);
    try {
      const logs = await process.getLogs();
      console.error('[Gateway] startup failed. Stderr:', logs.stderr);
      console.error('[Gateway] startup failed. Stdout:', logs.stdout);
      throw new Error(`Moltbot gateway failed to start. Stderr: ${logs.stderr || '(empty)'}`);
    } catch (logErr) {
      console.error('[Gateway] Failed to get logs:', logErr);
      throw e;
    }
  }

  // Verify gateway is actually responding
  console.log('[Gateway] Verifying gateway health...');
  
  return process;
}
