import path from 'node:path';
import { config, ensureDataDirs } from './config.js';
import { get, newId, nowIso, run } from './db.js';
import { downloadToFile } from './download.js';
import { MODRINTH_CDN_HOSTS } from './net.js';
import {
  getModrinthProject,
  getModrinthVersion,
  getModrinthVersions,
  selectPrimaryFile,
  type ModrinthProject,
  type ModrinthVersion,
} from './modrinth.js';
import { safeFileName } from './safety.js';
import { getLibraryPlugin, mapLibraryRow } from './library.js';
import { HttpError, conflict, notFound } from './util.js';
import type { LibraryPlugin, PluginDependency, ServerSoftware } from '../shared/types.js';

export { inspectJar as importJarFiles } from './jar.js';

const inFlight = new Map<string, Promise<LibraryPlugin>>();

function loaderFilterFor(software: ServerSoftware | undefined): string[] {
  switch (software) {
    case 'folia':
      return ['folia', 'paper', 'spigot', 'bukkit'];
    case 'leaf':
    case 'paper':
    default:
      return ['paper', 'spigot', 'bukkit'];
  }
}

export function mapModrinthDependencies(version: ModrinthVersion): PluginDependency[] {
  return (version.dependencies ?? []).map((dep) => ({
    projectId: dep.project_id ?? undefined,
    versionId: dep.version_id ?? undefined,
    name: dep.file_name ?? undefined,
    kind:
      dep.dependency_type === 'required' ||
      dep.dependency_type === 'optional' ||
      dep.dependency_type === 'incompatible' ||
      dep.dependency_type === 'embedded'
        ? dep.dependency_type
        : 'unknown',
  }));
}

function findCachedLibraryRow(projectId: string, versionId: string) {
  return get<any>(
    `SELECT * FROM library_plugins WHERE source = 'modrinth' AND source_project_id = ? AND source_version_id = ?`,
    [projectId, versionId],
  );
}

export interface InstallModrinthOptions {
  projectIdOrSlug: string;
  versionId?: string;
  mcVersion?: string;
  software?: ServerSoftware;
}

/**
 * Resolves a Modrinth plugin version, downloads it through the validated
 * download pipeline, verifies its hash, and caches it in the local library.
 * Downloaded files are never executed.
 */
export async function installModrinthPlugin(options: InstallModrinthOptions): Promise<{ plugin: LibraryPlugin; cached: boolean; warnings: string[] }> {
  let project: ModrinthProject;
  try {
    project = await getModrinthProject(options.projectIdOrSlug);
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) throw notFound('Modrinth project not found.');
    throw err;
  }

  let version: ModrinthVersion | null = null;
  const warnings: string[] = [];
  if (options.versionId) {
    version = await getModrinthVersion(options.versionId);
    if (version.project_id !== project.id) throw conflict('The selected version does not belong to this Modrinth project.');
  } else {
    const loaders = loaderFilterFor(options.software);
    const attempts: { loaders?: string[]; mcVersion?: string }[] = [
      { loaders, mcVersion: options.mcVersion },
      { loaders: undefined, mcVersion: options.mcVersion },
      { loaders, mcVersion: undefined },
      {},
    ];
    const seen = new Set<string>();
    for (const attempt of attempts) {
      const key = JSON.stringify(attempt);
      if (seen.has(key)) continue;
      seen.add(key);
      const versions = await getModrinthVersions(project.id, attempt);
      const usable = versions.find((v) => selectPrimaryFile(v) !== null);
      if (usable) {
        version = usable;
        if (options.mcVersion && !usable.game_versions.includes(options.mcVersion)) {
          warnings.push(`Selected version does not explicitly list Minecraft ${options.mcVersion}.`);
        }
        break;
      }
    }
    if (!version) throw notFound('No downloadable version of this plugin matched the current filters.');
  }

  const existing = findCachedLibraryRow(project.id, version.id);
  if (existing) {
    const mapped = mapLibraryRow(existing);
    if (mapped.hasFile) return { plugin: mapped, cached: true, warnings };
    // Cached row exists but the file is gone: re-download into the same path.
  }

  const versionKey = version.id;
  const pending = inFlight.get(versionKey);
  if (pending) {
    const plugin = await pending;
    return { plugin, cached: true, warnings };
  }

  const task = (async () => {
    ensureDataDirs();
    const file = selectPrimaryFile(version!);
    if (!file) throw notFound('The selected plugin version has no downloadable file.');
    const storedName = safeFileName(file.filename);
    const relPath = path.posix.join('plugins', 'modrinth', safeFileName(project.id), safeFileName(version!.id), storedName);
    const absPath = path.join(config.dataDir, relPath);
    const sha512 = file.hashes?.sha512;
    if (file.url) {
      await downloadToFile(file.url, absPath, {
        allowedHosts: MODRINTH_CDN_HOSTS,
        expectedSha512: sha512,
        maxBytes: config.maxDownloadBytes,
      });
    } else if (!existing) {
      throw new HttpError(502, 'download_failed', 'Modrinth did not provide a download URL for this version.');
    }
    const stat = await import('node:fs').then((fs) => fs.promises.stat(absPath));
    const loaders = version!.loaders ?? [];
    const now = nowIso();
    const categories = project.categories ?? [];
    const metadata = {
      projectSlug: project.slug,
      projectType: project.project_type,
      license: project.license?.id ?? null,
      sourceUrl: project.source_url ?? null,
      issuesUrl: project.issues_url ?? null,
      wikiUrl: project.wiki_url ?? null,
      versionName: version!.name,
      versionType: version!.version_type,
      publishedAt: version!.date_published,
      configDirGuess: null,
    };

    const existingId = existing?.id;
    if (existingId) {
      run(
        `UPDATE library_plugins SET file_path = ?, file_name = ?, file_hash = ?, file_size = ?, metadata = ?, updated_at = ? WHERE id = ?`,
        [relPath, storedName, sha512 ?? null, stat.size, JSON.stringify({ ...(existing.metadata ? JSON.parse(existing.metadata) : {}), ...metadata }), now, existingId],
      );
      return getLibraryPlugin(existingId)!;
    }

    const id = newId();
    run(
      `INSERT INTO library_plugins (id, source, source_project_id, source_version_id, source_url, name, slug, description,
        author, version, mc_versions, loaders, folia_compatible, categories, file_path, file_name, file_hash, file_size,
        icon_url, project_url, dependencies, notes, metadata, config_template_dir, created_at, updated_at)
       VALUES (?, 'modrinth', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, NULL, ?, ?)`,
      [
        id,
        project.id,
        version!.id,
        `https://modrinth.com/plugin/${project.slug}`,
        project.title,
        project.slug,
        project.description ?? '',
        '',
        version!.version_number,
        JSON.stringify(version!.game_versions ?? []),
        JSON.stringify(loaders),
        loaders.includes('folia') ? 1 : 0,
        JSON.stringify(categories),
        relPath,
        storedName,
        sha512 ?? null,
        stat.size,
        project.icon_url ?? null,
        `https://modrinth.com/plugin/${project.slug}`,
        JSON.stringify(mapModrinthDependencies(version!)),
        JSON.stringify(metadata),
        now,
        now,
      ],
    );
    return getLibraryPlugin(id)!;
  })();

  inFlight.set(versionKey, task);
  try {
    const plugin = await task;
    return { plugin, cached: false, warnings };
  } finally {
    inFlight.delete(versionKey);
  }
}

/** Re-validates that a cached Modrinth file still exists before a project uses it. */
export function requirePluginFile(plugin: LibraryPlugin): LibraryPlugin {
  if (!plugin.fileName) throw notFound('Library entry has no plugin file.');
  if (!plugin.hasFile) {
    throw conflict('The cached plugin file is missing from local storage. Re-download it first.', {
      code: 'file_missing',
      pluginId: plugin.id,
    });
  }
  return plugin;
}
