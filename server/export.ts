import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import archiver from 'archiver';
import { config, ensureDataDirs, storagePaths } from './config.js';
import { get } from './db.js';
import { listProjectConfigs, listProjectPlugins, getProject, normalizeConfigPath } from './projects.js';
import { getLibraryPlugin } from './library.js';
import { fromStorageRoot, assertSafeRelativePath, listZipEntries } from './safety.js';
import { conflict } from './util.js';
import type { ExportPreview, ExportPreviewEntry } from '../shared/types.js';

export interface ExportOptions {
  includeTemplateConfigs?: boolean;
  includeConfigIds?: string[] | null;
}

function safeArchiveName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return cleaned || 'server';
}

export function exportFileName(projectId: string): string {
  const project = getProject(projectId);
  return `${safeArchiveName(project.serverName || project.name)}-Setup.zip`;
}

interface ResolvedEntry extends ExportPreviewEntry {
  sourcePath?: string;
  content?: string;
}

export function resolveExportEntries(projectId: string, options: ExportOptions = {}): {
  entries: ResolvedEntry[];
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  const entries: ResolvedEntry[] = [];
  const plugins = listProjectPlugins(projectId);
  const includeTemplateConfigs = options.includeTemplateConfigs !== false;
  const allowedConfigIds = options.includeConfigIds ? new Set(options.includeConfigIds) : null;

  for (const plugin of plugins) {
    const library = plugin.libraryPluginId ? getLibraryPlugin(plugin.libraryPluginId) : null;
    if (!library) {
      errors.push(`"${plugin.displayName}" has no library entry, so its JAR cannot be included.`);
      continue;
    }
    const row = library.fileName && library.hasFile ? library : null;
    if (!row || !library.fileName) {
      errors.push(`Plugin file for "${plugin.displayName}" is missing from local storage. Re-download it before exporting.`);
      continue;
    }
    const storageRow = getLibraryFilePath(library.id);
    if (!storageRow) {
      errors.push(`Plugin file for "${plugin.displayName}" is not registered in storage.`);
      continue;
    }
    let size = 0;
    try {
      size = fs.statSync(fromStorageRoot(storageRow)).size;
    } catch {
      errors.push(`Plugin file for "${plugin.displayName}" could not be read.`);
      continue;
    }
    entries.push({
      path: `plugins/${assertSafeRelativePath(library.fileName)}`,
      size,
      source: 'plugin-jar',
      plugin: plugin.displayName,
      sourcePath: fromStorageRoot(storageRow),
    });
  }

  for (const cfg of listProjectConfigs(projectId)) {
    if (allowedConfigIds && !allowedConfigIds.has(cfg.id)) continue;
    if (!includeTemplateConfigs && cfg.origin === 'template') {
      warnings.push(`Skipped optional template config "${cfg.path}".`);
      continue;
    }
    let configPath: string;
    try {
      configPath = assertSafeRelativePath(normalizeConfigPath(cfg.path));
    } catch {
      errors.push(`Configuration path "${cfg.path}" is invalid and was blocked.`);
      continue;
    }
    entries.push({
      path: `plugins/${configPath}`,
      size: Buffer.byteLength(cfg.content, 'utf8'),
      source: 'config',
      plugin: 'Configuration',
      content: cfg.content,
    });
  }

  if (plugins.length === 0) warnings.push('This project has no plugins; the archive will only contain an empty plugins/ directory.');
  return { entries, errors, warnings };
}

function getLibraryFilePath(libraryId: string): string | null {
  const row = get<{ file_path: string | null }>('SELECT file_path FROM library_plugins WHERE id = ?', [libraryId]);
  return row?.file_path ?? null;
}

export function detectCollisions(entries: ExportPreviewEntry[]): { path: string; from: string[] }[] {
  const byLower = new Map<string, ExportPreviewEntry[]>();
  for (const entry of entries) {
    const key = entry.path.toLowerCase();
    const list = byLower.get(key) ?? [];
    list.push(entry);
    byLower.set(key, list);
  }
  const collisions: { path: string; from: string[] }[] = [];
  for (const [, list] of byLower) {
    if (list.length > 1) {
      collisions.push({ path: list[0].path, from: list.map((e) => e.plugin) });
    }
  }
  // File/directory conflicts, e.g. "plugins/TAB" file and "plugins/TAB/config.yml".
  const filePaths = new Set(entries.map((e) => e.path.replace(/\/+$/, '')));
  const directories = new Set<string>();
  for (const entry of entries) {
    const parts = entry.path.split('/');
    for (let i = 1; i < parts.length; i++) directories.add(parts.slice(0, i).join('/'));
  }
  for (const dir of directories) {
    if (filePaths.has(dir)) {
      collisions.push({ path: dir, from: ['A file and a directory share this path'] });
    }
  }
  return collisions;
}

export function buildExportPreview(projectId: string, options: ExportOptions = {}): ExportPreview {
  const project = getProject(projectId);
  const { entries, errors, warnings } = resolveExportEntries(projectId, options);
  const collisions = detectCollisions(entries);
  const errorList = [...errors];
  for (const collision of collisions) {
    errorList.push(`Path collision at "${collision.path}" (${collision.from.join(', ')}). Rename one of the conflicting files.`);
  }
  return {
    fileName: `${safeArchiveName(project.serverName || project.name)}-Setup.zip`,
    entries: entries.map(({ sourcePath, content, ...rest }) => rest),
    collisions,
    errors: errorList,
    warnings,
    fileCount: entries.length,
    totalBytes: entries.reduce((sum, e) => sum + e.size, 0),
  };
}

export interface CreatedArchive {
  filePath: string;
  fileName: string;
  entryCount: number;
  size: number;
  cleanup: () => Promise<void>;
}

/**
 * Builds the ZIP on disk. The archive always contains a top-level "plugins/"
 * directory and only project plugin JARs plus project configuration files.
 */
export async function createExportArchive(projectId: string, options: ExportOptions = {}): Promise<CreatedArchive> {
  const preview = buildExportPreview(projectId, options);
  if (preview.errors.length > 0) {
    throw conflict('Export validation failed.', { errors: preview.errors, collisions: preview.collisions });
  }
  const { entries } = resolveExportEntries(projectId, options);
  const resolved = entries.filter((e): e is ResolvedEntry => Boolean(e));
  if (resolved.length === 0) {
    throw conflict('Nothing to export: add plugins or configuration files first.');
  }

  ensureDataDirs();
  const tempDir = path.join(storagePaths.tmp, `export-${crypto.randomUUID()}`);
  await fsp.mkdir(tempDir, { recursive: true });
  const filePath = path.join(tempDir, preview.fileName);

  const output = fs.createWriteStream(filePath);
  const archive = archiver('zip', { zlib: { level: 9 } });

  const done = new Promise<void>((resolve, reject) => {
    output.on('close', () => resolve());
    output.on('error', reject);
    archive.on('error', reject);
    archive.on('warning', (err) => {
      if (err.code !== 'ENOENT') reject(err);
    });
  });

  archive.pipe(output);
  try {
    for (const entry of resolved) {
      if (entry.sourcePath) {
        archive.file(entry.sourcePath, { name: entry.path });
      } else if (entry.content !== undefined) {
        archive.append(entry.content, { name: entry.path });
      }
    }
    // Ensure the top-level plugins/ directory exists even with only nested files.
    archive.append('', { name: 'plugins/' });
    await archive.finalize();
    await done;
  } catch (err) {
    output.destroy();
    await fsp.rm(tempDir, { recursive: true, force: true });
    throw err;
  }

  const stat = await fsp.stat(filePath);

  // Validate the finished archive: every entry must live under plugins/.
  const archiveEntries = await listZipEntries(filePath, { maxEntries: 10000, maxTotalBytes: config.maxExtractedBytes });
  for (const entry of archiveEntries) {
    const isPluginsRoot = entry.fileName === 'plugins' && entry.isDirectory;
    if (!isPluginsRoot && !entry.fileName.startsWith('plugins/')) {
      await fsp.rm(tempDir, { recursive: true, force: true });
      throw conflict(`Exported archive contained a path outside plugins/: ${entry.fileName}`);
    }
  }

  return {
    filePath,
    fileName: preview.fileName,
    entryCount: archiveEntries.filter((e) => !e.isDirectory).length,
    size: stat.size,
    cleanup: async () => {
      await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    },
  };
}
