import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { asyncHandler } from '../util.js';
import { getBuilds, getMinecraftVersions, getSoftwareVersions, isValidMinecraftVersion } from '../mcmeta.js';
import { storagePaths } from '../config.js';
import { aiCapability, config } from '../config.js';
import { get, run } from '../db.js';

export const metaRouter = Router();

metaRouter.get(
  '/minecraft/versions',
  asyncHandler(async (req, res) => {
    const software = req.query.software === 'paper' || req.query.software === 'folia' || req.query.software === 'leaf' ? req.query.software : null;
    const [mojang, softwareMeta] = await Promise.all([
      getMinecraftVersions(),
      software ? getSoftwareVersions(software) : Promise.resolve(null),
    ]);
    res.json({
      versions: mojang.versions,
      cached: mojang.cached,
      warning: mojang.warning ?? softwareMeta?.warning,
      software: software
        ? {
            id: software,
            versions: softwareMeta?.versions ?? [],
            source: softwareMeta?.source ?? '',
            cached: softwareMeta?.cached ?? false,
          }
        : null,
    });
  }),
);

metaRouter.get(
  '/minecraft/validation',
  asyncHandler((req, res) => {
    const version = String(req.query.version ?? '').trim();
    res.json({ valid: isValidMinecraftVersion(version), version });
  }),
);

metaRouter.get(
  '/minecraft/builds',
  asyncHandler(async (req, res) => {
    const software = String(req.query.software ?? 'paper');
    const version = String(req.query.version ?? '').trim();
    if (!['paper', 'folia', 'leaf'].includes(software)) {
      res.status(400).json({ error: { code: 'bad_request', message: 'software must be paper, folia, or leaf' } });
      return;
    }
    if (!version) {
      res.status(400).json({ error: { code: 'bad_request', message: 'A Minecraft version is required.' } });
      return;
    }
    const [buildMeta, versionMeta] = await Promise.all([
      getBuilds(software as any, version),
      getSoftwareVersions(software as any),
    ]);
    res.json({
      software,
      version,
      builds: buildMeta.builds,
      buildsAvailable: buildMeta.buildsAvailable,
      versions: versionMeta.versions,
      supported: versionMeta.versions.includes(version),
      source: buildMeta.source,
      warning: buildMeta.warning ?? versionMeta.warning,
    });
  }),
);

function directorySize(dir: string): number {
  let total = 0;
  if (!fs.existsSync(dir)) return 0;
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        try {
          total += fs.statSync(full).size;
        } catch {
          /* ignore */
        }
      }
    }
  };
  walk(dir);
  return total;
}

metaRouter.get(
  '/health',
  asyncHandler((_req, res) => {
    res.json({ status: 'ok', version: '1.0.0', time: new Date().toISOString() });
  }),
);

const DEFAULT_SETTINGS: Record<string, string> = {
  default_language: 'en',
};

metaRouter.get(
  '/settings',
  asyncHandler((_req, res) => {
    const rows = get<any>('SELECT key, value FROM settings');
    const settings: Record<string, string> = { ...DEFAULT_SETTINGS };
    for (const row of rows ?? []) settings[row.key] = row.value;
    res.json({
      settings,
      ai: aiCapability(),
      limits: {
        maxUploadBytes: config.maxUploadBytes,
        maxArchiveEntries: config.maxArchiveEntries,
        maxExtractedBytes: config.maxExtractedBytes,
        maxDownloadBytes: config.maxDownloadBytes,
        requestTimeoutMs: config.requestTimeoutMs,
      },
      storage: {
        pluginBytes: directorySize(storagePaths.plugins),
        templateBytes: directorySize(storagePaths.templates),
        dataDirIsRelative: !path.isAbsolute(process.env.DATA_DIR || ''),
      },
      security: {
        publicDeployment: 'This application has no built-in authentication. Run it on localhost or behind an authenticated reverse proxy.',
        modrinthUserAgent: config.modrinthUserAgent,
        externalDownloads: 'Only Modrinth/CDN and PaperMC/GitHub metadata hosts are reachable for downloads.',
      },
    });
  }),
);

metaRouter.put(
  '/settings',
  asyncHandler((req, res) => {
    const entries = req.body?.settings;
    if (!entries || typeof entries !== 'object') {
      res.status(400).json({ error: { code: 'bad_request', message: 'settings object is required' } });
      return;
    }
    const allowed = new Set(['default_language']);
    for (const [key, value] of Object.entries(entries)) {
      if (!allowed.has(key)) continue;
      const stringValue = String(value);
      run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [
        key,
        stringValue,
      ]);
    }
    res.json({ settings: Object.fromEntries(Object.keys(entries).map((k) => [k, String(entries[k])])) });
  }),
);
