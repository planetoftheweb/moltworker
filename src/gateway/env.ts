import type { MoltbotEnv } from '../types';

/**
 * Generate a fingerprint of which env vars are currently available.
 * Used to detect when secrets have changed (e.g., after `wrangler secret put`)
 * so we can restart the container process with the new values.
 * 
 * Only hashes the KEYS that are present, not the values (for security).
 */
export function getEnvFingerprint(env: MoltbotEnv): string {
  const keys: string[] = [];
  // Check all passthrough env vars in a stable order
  if (env.AI_GATEWAY_API_KEY) keys.push('AI_GATEWAY_API_KEY');
  if (env.AI_GATEWAY_BASE_URL) keys.push('AI_GATEWAY_BASE_URL');
  if (env.ANTHROPIC_API_KEY) keys.push('ANTHROPIC_API_KEY');
  if (env.ANTHROPIC_BASE_URL) keys.push('ANTHROPIC_BASE_URL');
  if (env.OPENAI_API_KEY) keys.push('OPENAI_API_KEY');
  if (env.MOLTBOT_GATEWAY_TOKEN) keys.push('MOLTBOT_GATEWAY_TOKEN');
  if (env.DEV_MODE) keys.push('DEV_MODE');
  if (env.CLAWDBOT_BIND_MODE) keys.push('CLAWDBOT_BIND_MODE');
  if (env.TELEGRAM_BOT_TOKEN) keys.push('TELEGRAM_BOT_TOKEN');
  if (env.TELEGRAM_DM_POLICY) keys.push('TELEGRAM_DM_POLICY');
  if (env.DISCORD_BOT_TOKEN) keys.push('DISCORD_BOT_TOKEN');
  if (env.DISCORD_DM_POLICY) keys.push('DISCORD_DM_POLICY');
  if (env.SLACK_BOT_TOKEN) keys.push('SLACK_BOT_TOKEN');
  if (env.SLACK_APP_TOKEN) keys.push('SLACK_APP_TOKEN');
  if (env.CDP_SECRET) keys.push('CDP_SECRET');
  if (env.WORKER_URL) keys.push('WORKER_URL');
  if (env.GITHUB_TOKEN) keys.push('GITHUB_TOKEN');
  if (env.BRAVE_API_KEY) keys.push('BRAVE_API_KEY');
  if (env.X_BEARER_TOKEN) keys.push('X_BEARER_TOKEN');
  if (env.X_CONSUMER_KEY) keys.push('X_CONSUMER_KEY');
  if (env.X_CONSUMER_SECRET) keys.push('X_CONSUMER_SECRET');
  if (env.X_ACCESS_TOKEN) keys.push('X_ACCESS_TOKEN');
  if (env.X_ACCESS_TOKEN_SECRET) keys.push('X_ACCESS_TOKEN_SECRET');
  if (env.OPENROUTER_API_KEY) keys.push('OPENROUTER_API_KEY');
  if (env.VIBEIT_API_KEY) keys.push('VIBEIT_API_KEY');
  if (env.PUBLER_API_KEY) keys.push('PUBLER_API_KEY');
  if (env.PUBLER_WORKSPACE_ID) keys.push('PUBLER_WORKSPACE_ID');
  return keys.sort().join(',');
}

/**
 * Build environment variables to pass to the Moltbot container process
 * 
 * @param env - Worker environment bindings
 * @returns Environment variables record
 */
export function buildEnvVars(env: MoltbotEnv): Record<string, string> {
  const envVars: Record<string, string> = {};

  // Normalize the base URL by removing trailing slashes
  const normalizedBaseUrl = env.AI_GATEWAY_BASE_URL?.replace(/\/+$/, '');
  const isOpenAIGateway = normalizedBaseUrl?.endsWith('/openai');

  // AI Gateway vars take precedence
  // Map to the appropriate provider env var based on the gateway endpoint
  if (env.AI_GATEWAY_API_KEY) {
    if (isOpenAIGateway) {
      envVars.OPENAI_API_KEY = env.AI_GATEWAY_API_KEY;
    } else {
      envVars.ANTHROPIC_API_KEY = env.AI_GATEWAY_API_KEY;
    }
  }

  // Fall back to direct provider keys
  if (!envVars.ANTHROPIC_API_KEY && env.ANTHROPIC_API_KEY) {
    envVars.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY;
  }
  if (!envVars.OPENAI_API_KEY && env.OPENAI_API_KEY) {
    envVars.OPENAI_API_KEY = env.OPENAI_API_KEY;
  }

  // Pass base URL (used by start-moltbot.sh to determine provider)
  if (normalizedBaseUrl) {
    envVars.AI_GATEWAY_BASE_URL = normalizedBaseUrl;
    // Also set the provider-specific base URL env var
    if (isOpenAIGateway) {
      envVars.OPENAI_BASE_URL = normalizedBaseUrl;
    } else {
      envVars.ANTHROPIC_BASE_URL = normalizedBaseUrl;
    }
  } else if (env.ANTHROPIC_BASE_URL) {
    envVars.ANTHROPIC_BASE_URL = env.ANTHROPIC_BASE_URL;
  }
  // Map MOLTBOT_GATEWAY_TOKEN to CLAWDBOT_GATEWAY_TOKEN (container expects this name)
  if (env.MOLTBOT_GATEWAY_TOKEN) envVars.CLAWDBOT_GATEWAY_TOKEN = env.MOLTBOT_GATEWAY_TOKEN;
  if (env.DEV_MODE) envVars.CLAWDBOT_DEV_MODE = env.DEV_MODE; // Pass DEV_MODE as CLAWDBOT_DEV_MODE to container
  if (env.CLAWDBOT_BIND_MODE) envVars.CLAWDBOT_BIND_MODE = env.CLAWDBOT_BIND_MODE;
  if (env.TELEGRAM_BOT_TOKEN) envVars.TELEGRAM_BOT_TOKEN = env.TELEGRAM_BOT_TOKEN;
  if (env.TELEGRAM_DM_POLICY) envVars.TELEGRAM_DM_POLICY = env.TELEGRAM_DM_POLICY;
  if (env.DISCORD_BOT_TOKEN) envVars.DISCORD_BOT_TOKEN = env.DISCORD_BOT_TOKEN;
  if (env.DISCORD_DM_POLICY) envVars.DISCORD_DM_POLICY = env.DISCORD_DM_POLICY;
  if (env.SLACK_BOT_TOKEN) envVars.SLACK_BOT_TOKEN = env.SLACK_BOT_TOKEN;
  if (env.SLACK_APP_TOKEN) envVars.SLACK_APP_TOKEN = env.SLACK_APP_TOKEN;
  if (env.CDP_SECRET) envVars.CDP_SECRET = env.CDP_SECRET;
  if (env.WORKER_URL) envVars.WORKER_URL = env.WORKER_URL;
  if (env.GITHUB_TOKEN) envVars.GITHUB_TOKEN = env.GITHUB_TOKEN;
  if (env.BRAVE_API_KEY) envVars.BRAVE_API_KEY = env.BRAVE_API_KEY;
  if (env.X_BEARER_TOKEN) envVars.X_BEARER_TOKEN = env.X_BEARER_TOKEN;
  if (env.X_CONSUMER_KEY) envVars.X_CONSUMER_KEY = env.X_CONSUMER_KEY;
  if (env.X_CONSUMER_SECRET) envVars.X_CONSUMER_SECRET = env.X_CONSUMER_SECRET;
  if (env.X_ACCESS_TOKEN) envVars.X_ACCESS_TOKEN = env.X_ACCESS_TOKEN;
  if (env.X_ACCESS_TOKEN_SECRET) envVars.X_ACCESS_TOKEN_SECRET = env.X_ACCESS_TOKEN_SECRET;
  if (env.OPENROUTER_API_KEY) envVars.OPENROUTER_API_KEY = env.OPENROUTER_API_KEY;
  if (env.VIBEIT_API_KEY) envVars.VIBEIT_API_KEY = env.VIBEIT_API_KEY;
  if (env.PUBLER_API_KEY) envVars.PUBLER_API_KEY = env.PUBLER_API_KEY;
  if (env.PUBLER_WORKSPACE_ID) envVars.PUBLER_WORKSPACE_ID = env.PUBLER_WORKSPACE_ID;

  return envVars;
}
