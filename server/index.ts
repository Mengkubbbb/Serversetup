import { createApp } from './app.js';
import { config, ensureDataDirs, aiCapability, storagePaths } from './config.js';
import { getDb } from './db.js';
import { seedTemplates } from './templateSeed.js';
import { cleanupPartialDownloads } from './download.js';

ensureDataDirs();
getDb();
seedTemplates();

cleanupPartialDownloads(storagePaths.plugins)
  .then((removed) => {
    if (removed > 0) console.log(`[server-setup-maker] Removed ${removed} interrupted download file(s).`);
  })
  .catch(() => undefined);

const app = createApp();
const server = app.listen(config.port, config.host, () => {
  const capability = aiCapability();
  console.log(`[server-setup-maker] API listening on http://${config.host}:${config.port}`);
  console.log(`[server-setup-maker] Data directory: ${config.dataDir}`);
  console.log(`[server-setup-maker] AI: ${capability.configured ? `${capability.provider} / ${capability.model}` : 'not configured (manual workflow only)'}`);
});

function shutdown(signal: string) {
  console.log(`[server-setup-maker] ${signal} received, shutting down.`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
