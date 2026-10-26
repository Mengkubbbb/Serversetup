import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const dataDir = path.resolve(process.env.DATA_DIR || './storage');

export const config = {
  port: intEnv('PORT', 8787),
  host: process.env.HOST || '127.0.0.1',
  dataDir,
  dbPath: path.join(dataDir, 'app.db'),
  maxUploadBytes: intEnv('MAX_UPLOAD_BYTES', 64 * 1024 * 1024),
  maxArchiveEntries: intEnv('MAX_ARCHIVE_ENTRIES', 2000),
  maxExtractedBytes: intEnv('MAX_EXTRACTED_BYTES', 256 * 1024 * 1024),
  maxDownloadBytes: intEnv('MAX_DOWNLOAD_BYTES', 128 * 1024 * 1024),
  requestTimeoutMs: intEnv('REQUEST_TIMEOUT_MS', 20000),
  modrinthUserAgent:
    process.env.MODRINTH_USER_AGENT || 'serversetup-maker/1.0 (self-hosted)',
  githubToken: process.env.GITHUB_TOKEN || '',
  corsOrigins: (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  ai: {
    provider: (process.env.AI_PROVIDER || 'none').toLowerCase(),
    apiKey: process.env.AI_API_KEY || '',
    model: process.env.AI_MODEL || 'gpt-4o-mini',
    baseUrl: (process.env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
  },
  isTest: process.env.NODE_ENV === 'test',
};

export const storagePaths = {
  root: dataDir,
  plugins: path.join(dataDir, 'plugins'),
  modrinth: path.join(dataDir, 'plugins', 'modrinth'),
  uploaded: path.join(dataDir, 'plugins', 'uploaded'),
  cache: path.join(dataDir, 'plugins', 'cache'),
  templates: path.join(dataDir, 'templates'),
  tmp: path.join(dataDir, 'tmp'),
};

export function ensureDataDirs(): void {
  for (const dir of Object.values(storagePaths)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function aiCapability(): { configured: boolean; provider: string; model: string; reason?: string } {
  const { provider, apiKey } = config.ai;
  if (provider === 'none' || provider === '') {
    return { configured: false, provider: 'none', model: config.ai.model, reason: 'AI_PROVIDER is not configured.' };
  }
  if (provider !== 'openai' && provider !== 'openai-compatible') {
    return { configured: false, provider, model: config.ai.model, reason: `Unsupported AI_PROVIDER "${provider}".` };
  }
  if (!apiKey) {
    return { configured: false, provider, model: config.ai.model, reason: 'AI_API_KEY is not set.' };
  }
  return { configured: true, provider, model: config.ai.model };
}
