import fs from 'node:fs';
import fsp from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { config } from './config.js';
import { all, get, newId, nowIso, parseJson, run } from './db.js';
import { fileExists, fromStorageRoot, resolveInside, safeFileName, toStorageRoot } from './safety.js';
import { badRequest, conflict, notFound } from './util.js';

import { inspectJar, type JarInspection } from './jar.js';
import type { LibraryPlugin, PluginSource } from '../shared/types.js';

export const DEFAULT_CATEGORIES = [
  'Administration',
  'Permissions',
  'Economy',
  'Essentials',
  'Protection',
  'World Management',
  'Performance',
  'Optimization',
  'Chat',
  'Scoreboards',
  'TAB',
  'GUI',
  'Dialogs',
  'NPCs',
  'Crates',
  'Shops',
  'Auction House',
  'Homes',
  'Teleportation',
  'Authentication',
  'Bedrock Compatibility',
  'Developer Tools',
  'Other',
];

const KNOWN_CONFIG_FOLDERS: Record<string, string> = {
  essentials: 'Essentials',
  essentialsx: 'Essentials',
  luckperms: 'LuckPerms',
  tab: 'TAB',
  placeholderapi: 'PlaceholderAPI',
  vault: 'Vault',
  worldguard: 'WorldGuard',
  worldedit: 'WorldEdit',
  coreprotect: 'CoreProtect',
  griefprevention: 'GriefPrevention',
  towny: 'Towny',
  lands: 'Lands',
  dynmap: 'dynmap',
  bluemap: 'BlueMap',
  citizens: 'Citizens',
  deluxemenus: 'DeluxeMenus',
  chestshop: 'ChestShop',
  auctionhouse: 'AuctionHouse',
  essentialsxchat: 'Essentials',
  luckpermsbukkit: 'LuckPerms',
  viaversion: 'ViaVersion',
  viabackwards: 'ViaBackwards',
  geyser: 'Geyser-Spigot',
  floodgate: 'floodgate',
  spark: 'spark',
  chunky: 'Chunky',
  worldguardextraflags: 'WorldGuardExtraFlags',
  simplevoicechat: 'voicechat',
  multicurrency: 'MultiCurrency',
  shopguiplus: 'ShopGUI+',
  headdatabase: 'HeadDatabase',
  protocolib: 'ProtocolLib',
  craftbook: 'CraftBook',
  papi: 'PlaceholderAPI',
};

export function inferConfigDir(pluginName: string, manifestName?: string | null): string {
  const candidates = [manifestName, pluginName].filter(Boolean) as string[];
  for (const candidate of candidates) {
    const key = candidate.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (KNOWN_CONFIG_FOLDERS[key]) return KNOWN_CONFIG_FOLDERS[key];
  }
  const base = (manifestName || pluginName).replace(/\s+/g, '');
  return safeFileName(base).replace(/\.(jar|zip)$/i, '') || 'Plugin';
}

export function mapLibraryRow(row: any): LibraryPlugin {
  const filePath = row.file_path ? fromStorageRoot(row.file_path) : null;
  const hasFile = filePath ? fileExists(filePath) : false;
  return {
    id: row.id,
    source: row.source as PluginSource,
    sourceProjectId: row.source_project_id ?? null,
    sourceVersionId: row.source_version_id ?? null,
    sourceUrl: row.source_url ?? null,
    name: row.name,
    slug: row.slug ?? null,
    description: row.description ?? '',
    author: row.author ?? '',
    version: row.version ?? null,
    mcVersions: parseJson<string[]>(row.mc_versions, []),
    loaders: parseJson<string[]>(row.loaders, []),
    foliaCompatible: row.folia_compatible === null || row.folia_compatible === undefined ? null : Boolean(row.folia_compatible),
    categories: parseJson<string[]>(row.categories, []),
    fileName: row.file_name ?? null,
    fileHash: row.file_hash ?? null,
    fileSize: row.file_size ?? null,
    iconUrl: row.icon_url ?? null,
    projectUrl: row.project_url ?? null,
    dependencies: parseJson(row.dependencies, []),
    notes: row.notes ?? '',
    configTemplateDir: row.config_template_dir ?? null,
    hasFile,
    fileMissing: Boolean(row.file_path) && !hasFile,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getLibraryPlugin(id: string): LibraryPlugin | null {
  const row = get('SELECT * FROM library_plugins WHERE id = ?', [id]);
  return row ? mapLibraryRow(row) : null;
}

export interface LibraryQuery {
  q?: string;
  category?: string;
  source?: PluginSource | 'all';
  mcVersion?: string;
  software?: string;
  hasFileOnly?: boolean;
  limit?: number;
  offset?: number;
  sort?: 'recent' | 'name';
}

export function listLibrary(query: LibraryQuery = {}): { items: LibraryPlugin[]; total: number } {
  const where: string[] = [];
  const params: any[] = [];
  if (query.q) {
    where.push('(lower(name) LIKE ? OR lower(description) LIKE ? OR lower(slug) LIKE ? OR lower(author) LIKE ?)');
    const like = `%${query.q.toLowerCase()}%`;
    params.push(like, like, like, like);
  }
  if (query.source && query.source !== 'all') {
    where.push('source = ?');
    params.push(query.source);
  }
  if (query.category) {
    where.push('lower(categories) LIKE ?');
    params.push(`%${query.category.toLowerCase()}%`);
  }
  if (query.mcVersion) {
    where.push('mc_versions LIKE ?');
    params.push(`%"${query.mcVersion}"%`);
  }
  if (query.software) {
    where.push('loaders LIKE ?');
    params.push(`%${query.software.toLowerCase()}%`);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const order = query.sort === 'name' ? 'ORDER BY lower(name) ASC' : 'ORDER BY created_at DESC';
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
  const offset = Math.max(query.offset ?? 0, 0);
  const totalRow = get<{ c: number }>(`SELECT COUNT(*) as c FROM library_plugins ${clause}`, params);
  const rows = all(`SELECT * FROM library_plugins ${clause} ${order} LIMIT ? OFFSET ?`, [...params, limit, offset]);
  let items = rows.map(mapLibraryRow);
  if (query.hasFileOnly) items = items.filter((p) => p.hasFile);
  return { items, total: totalRow?.c ?? items.length };
}

export function listCategories(): { name: string; builtin: boolean; count: number }[] {
  const custom = all<{ name: string; builtin: number }>('SELECT name, builtin FROM categories ORDER BY name');
  const counts = new Map<string, number>();
  for (const row of all<{ categories: string }>('SELECT categories FROM library_plugins')) {
    for (const c of parseJson<string[]>(row.categories, [])) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  const names = new Map<string, boolean>();
  for (const name of DEFAULT_CATEGORIES) names.set(name, true);
  for (const row of custom) names.set(row.name, Boolean(row.builtin));
  return Array.from(names.entries())
    .map(([name, builtin]) => ({ name, builtin, count: counts.get(name) ?? 0 }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function addCategory(name: string): void {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 60) throw badRequest('Category name must be 1-60 characters.');
  run('INSERT OR IGNORE INTO categories (id, name, builtin) VALUES (?, ?, 0)', [newId(), trimmed]);
}

export function deleteCategory(name: string): void {
  run('DELETE FROM categories WHERE name = ? AND builtin = 0', [name]);
}

export function updateLibraryPlugin(id: string, patch: Partial<Pick<LibraryPlugin, 'name' | 'description' | 'author' | 'version' | 'categories' | 'mcVersions' | 'loaders' | 'notes' | 'projectUrl' | 'iconUrl'>>): LibraryPlugin {
  const existing = getLibraryPlugin(id);
  if (!existing) throw notFound('Plugin not found in the local library.');
  const fields: string[] = [];
  const params: any[] = [];
  const set = (column: string, value: unknown) => {
    fields.push(`${column} = ?`);
    params.push(value);
  };
  if (patch.name !== undefined) set('name', patch.name.trim());
  if (patch.description !== undefined) set('description', patch.description);
  if (patch.author !== undefined) set('author', patch.author);
  if (patch.version !== undefined) set('version', patch.version);
  if (patch.categories !== undefined) set('categories', JSON.stringify(patch.categories));
  if (patch.mcVersions !== undefined) set('mc_versions', JSON.stringify(patch.mcVersions));
  if (patch.loaders !== undefined) set('loaders', JSON.stringify(patch.loaders));
  if (patch.notes !== undefined) set('notes', patch.notes);
  if (patch.projectUrl !== undefined) set('project_url', patch.projectUrl);
  if (patch.iconUrl !== undefined) set('icon_url', patch.iconUrl);
  if (fields.length === 0) return existing;
  set('updated_at', nowIso());
  run(`UPDATE library_plugins SET ${fields.join(', ')} WHERE id = ?`, [...params, id]);
  return getLibraryPlugin(id)!;
}

export function deleteLibraryPlugin(id: string, options: { force?: boolean } = {}): void {
  const existing = getLibraryPlugin(id);
  if (!existing) throw notFound('Plugin not found.');
  const refs = all<{ project_id: string }>('SELECT project_id FROM project_plugins WHERE library_plugin_id = ?', [id]);
  if (refs.length > 0 && !options.force) {
    throw conflict(
      `Plugin is used by ${new Set(refs.map((r) => r.project_id)).size} project(s). Remove it from those projects or force-delete.`,
      { projectUses: refs.length },
    );
  }
  const row = get<any>('SELECT file_path, config_template_dir FROM library_plugins WHERE id = ?', [id]);
  run('DELETE FROM library_plugins WHERE id = ?', [id]);
  if (!row) return;
  // Shared cache safety: only remove files no other entry references.
  if (row.file_path) {
    const other = get<{ c: number }>('SELECT COUNT(*) as c FROM library_plugins WHERE file_path = ?', [row.file_path]);
    if (!other || other.c === 0) {
      try {
        const abs = fromStorageRoot(row.file_path);
        fs.rmSync(abs, { force: true });
      } catch {
        /* ignore cleanup errors */
      }
    }
  }
  if (row.config_template_dir) {
    try {
      const abs = fromStorageRoot(row.config_template_dir);
      fs.rmSync(abs, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
  if (refs.length > 0) {
    run('UPDATE project_plugins SET library_plugin_id = NULL, status = \'missing\' WHERE library_plugin_id = ?', [id]);
  }
}

export async function hashFile(filePath: string): Promise<{ sha256: string; bytes: number }> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    let bytes = 0;
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => {
      bytes += chunk.length;
      hash.update(chunk);
    });
    stream.on('error', reject);
    stream.on('end', () => resolve({ sha256: hash.digest('hex'), bytes }));
  });
}

export interface UploadedPluginInput {
  tempPath: string;
  originalName: string;
  name?: string;
  version?: string;
  description?: string;
  author?: string;
  categories?: string[];
  mcVersions?: string[];
  loaders?: string[];
  notes?: string;
  projectUrl?: string;
  configDir?: string;
  /** Attach an uploaded configuration template to an existing library plugin. */
  linkToPluginId?: string;
}

export async function importJarUpload(input: UploadedPluginInput): Promise<{ plugin: LibraryPlugin; inspection: JarInspection }> {
  const extension = path.extname(input.originalName || input.tempPath).toLowerCase();
  if (extension !== '.jar') throw badRequest('Plugin uploads must be .jar files. Use the template upload for .zip archives.');
  const size = (await fsp.stat(input.tempPath)).size;
  if (size <= 0) throw badRequest('Uploaded file is empty.');
  if (size > config.maxUploadBytes) throw badRequest('Uploaded file exceeds the maximum upload size.');

  const { sha256 } = await hashFile(input.tempPath);
  const duplicate = get<any>('SELECT id FROM library_plugins WHERE file_hash = ?', [sha256]);
  if (duplicate) {
    throw conflict('An identical plugin file is already in the library.', { existingId: duplicate.id });
  }

  const inspection = await inspectJar(input.tempPath);
  const id = newId();
  const storedName = safeFileName(input.originalName || 'plugin.jar');
  const relDir = path.posix.join('plugins', 'uploaded', id);
  const absDir = resolveInside(config.dataDir, relDir);
  await fsp.mkdir(absDir, { recursive: true });
  const relPath = path.posix.join(relDir, storedName);
  await fsp.rename(input.tempPath, resolveInside(config.dataDir, relPath));

  const name = input.name?.trim() || inspection.name || path.basename(storedName, '.jar');
  const categories = input.categories?.length ? input.categories : ['Other'];
  const mcVersions = input.mcVersions ?? [];
  const loaders = input.loaders?.length ? input.loaders.map((l) => l.toLowerCase()) : ['paper', 'spigot', 'bukkit'];
  const now = nowIso();

  run(
    `INSERT INTO library_plugins (id, source, source_project_id, source_version_id, source_url, name, slug, description,
      author, version, mc_versions, loaders, folia_compatible, categories, file_path, file_name, file_hash, file_size,
      icon_url, project_url, dependencies, notes, metadata, config_template_dir, created_at, updated_at)
     VALUES (?, 'local', NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, NULL, ?, ?)`,
    [
      id,
      name,
      null,
      input.description?.trim() || inspection.description || '',
      input.author?.trim() || inspection.authors.join(', '),
      input.version?.trim() || inspection.version || 'unknown',
      JSON.stringify(mcVersions),
      JSON.stringify(loaders),
      inspection.foliaSupported === null ? null : inspection.foliaSupported ? 1 : 0,
      JSON.stringify(categories),
      relPath,
      storedName,
      sha256,
      size,
      input.projectUrl?.trim() || inspection.website || null,
      JSON.stringify(
        [
          ...inspection.depends.map((d) => ({ name: d, kind: 'required' })),
          ...inspection.softDepends.map((d) => ({ name: d, kind: 'optional' })),
        ],
      ),
      input.notes ?? '',
      JSON.stringify({
        apiVersion: inspection.apiVersion,
        main: inspection.main,
        pluginYml: inspection.pluginYml,
        commands: inspection.commands,
        permissions: inspection.permissions,
        configDirGuess: input.configDir?.trim() || inferConfigDir(name),
        warnings: inspection.warnings,
      }),
      now,
      now,
    ],
  );

  return { plugin: getLibraryPlugin(id)!, inspection };
}

export async function importTemplateUpload(input: UploadedPluginInput): Promise<{ plugin: LibraryPlugin; files: string[]; skipped: string[] }> {
  const extension = path.extname(input.originalName || input.tempPath).toLowerCase();
  if (extension !== '.zip') throw badRequest('Configuration templates must be uploaded as .zip archives.');
  const id = newId();
  const relDir = path.posix.join('templates', id);
  const absDir = resolveInside(config.dataDir, relDir);
  const extractedDir = path.join(absDir, 'files');
  fs.mkdirSync(extractedDir, { recursive: true });

  const { extractTextArchive } = await import('./safety.js');
  let result: { extracted: string[]; skipped: string[]; totalBytes: number };
  try {
    result = await extractTextArchive(input.tempPath, extractedDir);
  } catch (err) {
    fs.rmSync(absDir, { recursive: true, force: true });
    await fsp.rm(input.tempPath, { force: true });
    throw err;
  }
  if (result.extracted.length === 0) {
    fs.rmSync(absDir, { recursive: true, force: true });
    await fsp.rm(input.tempPath, { force: true });
    throw badRequest('The archive did not contain any configuration files (yaml/json/toml/text).');
  }

  // Preserve the original archive for reference but never include it in exports.
  await fsp.rename(input.tempPath, path.join(absDir, 'original.zip'));
  const { sha256, bytes } = await hashFile(path.join(absDir, 'original.zip'));

  if (input.linkToPluginId) {
    const target = getLibraryPlugin(input.linkToPluginId);
    if (!target) {
      fs.rmSync(absDir, { recursive: true, force: true });
      throw notFound('The plugin to attach this template to was not found.');
    }
    const previous = get<any>('SELECT config_template_dir, metadata FROM library_plugins WHERE id = ?', [target.id]);
    const metadata = { ...parseJson<Record<string, unknown>>(previous?.metadata, {}), templateFiles: result.extracted, skippedFiles: result.skipped };
    run('UPDATE library_plugins SET config_template_dir = ?, metadata = ?, updated_at = ? WHERE id = ?', [
      path.posix.join(relDir, 'files'),
      JSON.stringify(metadata),
      nowIso(),
      target.id,
    ]);
    if (previous?.config_template_dir && previous.config_template_dir !== path.posix.join(relDir, 'files')) {
      try {
        fs.rmSync(fromStorageRoot(previous.config_template_dir), { recursive: true, force: true });
      } catch {
        /* keep going: stale directories are harmless */
      }
    }
    return { plugin: getLibraryPlugin(target.id)!, files: result.extracted, skipped: result.skipped };
  }

  const name = input.name?.trim() || input.originalName.replace(/\.zip$/i, '');
  const now = nowIso();
  run(
    `INSERT INTO library_plugins (id, source, source_project_id, source_version_id, source_url, name, slug, description,
      author, version, mc_versions, loaders, folia_compatible, categories, file_path, file_name, file_hash, file_size,
      icon_url, project_url, dependencies, notes, metadata, config_template_dir, created_at, updated_at)
     VALUES (?, 'local', NULL, NULL, NULL, ?, NULL, ?, ?, ?, ?, ?, NULL, ?, NULL, NULL, ?, ?, NULL, ?, '[]', ?, ?, ?, ?, ?)`,
    [
      id,
      name,
      input.description?.trim() || '',
      input.author?.trim() || '',
      input.version?.trim() || 'template',
      JSON.stringify(input.mcVersions ?? []),
      JSON.stringify(input.loaders ?? []),
      JSON.stringify(input.categories?.length ? input.categories : ['Other']),
      sha256,
      bytes,
      input.projectUrl?.trim() || null,
      input.notes ?? '',
      JSON.stringify({ templateFiles: result.extracted, skippedFiles: result.skipped, originalBytes: bytes }),
      path.posix.join(relDir, 'files'),
      now,
      now,
    ],
  );

  return { plugin: getLibraryPlugin(id)!, files: result.extracted, skipped: result.skipped };
}

export function listTemplateFiles(plugin: LibraryPlugin): string[] {
  if (!plugin.configTemplateDir) return [];
  const abs = fromStorageRoot(plugin.configTemplateDir);
  const files: string[] = [];
  const walk = (dir: string, prefix = '') => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const next = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), next);
      else files.push(next);
    }
  };
  if (fs.existsSync(abs)) walk(abs);
  return files;
}

export function readTemplateFile(plugin: LibraryPlugin, relativePath: string): { path: string; content: string } {
  if (!plugin.configTemplateDir) throw notFound('This library entry has no configuration template.');
  const abs = resolveInside(fromStorageRoot(plugin.configTemplateDir), relativePath);
  const content = fs.readFileSync(abs, 'utf8');
  return { path: toStorageRoot(abs), content };
}
