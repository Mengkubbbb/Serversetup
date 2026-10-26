import fs from 'node:fs';
import path from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { newId, nowIso, parseJson, get, all, run, transaction } from './db.js';
import { evaluateCompatibility, worstCompatibility } from './compat.js';
import { getLibraryPlugin, inferConfigDir, listTemplateFiles, mapLibraryRow, readTemplateFile } from './library.js';
import { fromStorageRoot } from './safety.js';
import { parseYamlSafe } from './yaml.js';
import { badRequest, conflict, notFound } from './util.js';
import { installModrinthPlugin } from './installer.js';
import type {
  CompatibilityResult,
  LibraryPlugin,
  Language,
  Project,
  ProjectConfig,
  ProjectPlugin,
  ServerSoftware,
  VersionChannel,
} from '../shared/types.js';

export interface ProjectRow {
  id: string;
  name: string;
  server_name: string;
  description: string;
  icon: string | null;
  language: Language;
  mc_version: string;
  version_channel: VersionChannel;
  version_verified: number;
  software: ServerSoftware;
  software_build: string | null;
  template_id: string | null;
  created_at: string;
  updated_at: string;
}

export function mapProjectRow(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    serverName: row.server_name,
    description: row.description ?? '',
    icon: row.icon ?? null,
    language: row.language,
    mcVersion: row.mc_version,
    versionChannel: row.version_channel,
    versionVerified: Boolean(row.version_verified),
    software: row.software,
    softwareBuild: row.software_build ?? null,
    templateId: row.template_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getProjectRow(id: string): ProjectRow {
  const row = get<ProjectRow>('SELECT * FROM projects WHERE id = ?', [id]);
  if (!row) throw notFound('Project not found.');
  return row;
}

export function getProject(id: string): Project {
  const project = mapProjectRow(getProjectRow(id));
  const plugins = listProjectPlugins(id);
  const template = project.templateId ? get<any>('SELECT name FROM templates WHERE id = ?', [project.templateId]) : null;
  return {
    ...project,
    templateName: template?.name ?? null,
    pluginCount: plugins.length,
    missingPluginCount: plugins.filter((p) => p.status === 'missing').length,
    warningCount: plugins.filter((p) => p.compatibility.level === 'incompatible' || p.compatibility.level === 'unknown').length,
  };
}

export function listProjects(): Project[] {
  const rows = all<ProjectRow>('SELECT * FROM projects ORDER BY updated_at DESC');
  return rows.map((row) => {
    const project = mapProjectRow(row);
    const counts = get<{ total: number; missing: number }>(
      `SELECT COUNT(*) as total, SUM(CASE WHEN status = 'missing' THEN 1 ELSE 0 END) as missing
       FROM project_plugins WHERE project_id = ?`,
      [row.id],
    );
    return {
      ...project,
      pluginCount: counts?.total ?? 0,
      missingPluginCount: counts?.missing ?? 0,
    };
  });
}

export interface CreateProjectInput {
  name: string;
  serverName: string;
  language: Language;
  description?: string;
  icon?: string | null;
  mcVersion: string;
  versionChannel?: VersionChannel;
  versionVerified?: boolean;
  software: ServerSoftware;
  softwareBuild?: string | null;
  templateId?: string | null;
}

export function createProject(input: CreateProjectInput): Project {
  const id = newId();
  const now = nowIso();
  run(
    `INSERT INTO projects (id, name, server_name, description, icon, language, mc_version, version_channel,
      version_verified, software, software_build, template_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.name.trim(),
      input.serverName.trim(),
      input.description ?? '',
      input.icon ?? null,
      input.language,
      input.mcVersion,
      input.versionChannel ?? 'custom',
      input.versionVerified ? 1 : 0,
      input.software,
      input.softwareBuild ?? null,
      input.templateId ?? null,
      now,
      now,
    ],
  );
  return getProject(id);
}

export function updateProject(
  id: string,
  patch: Partial<Pick<Project, 'name' | 'serverName' | 'description' | 'icon' | 'language' | 'mcVersion' | 'versionChannel' | 'versionVerified' | 'software' | 'softwareBuild' | 'templateId'>>,
): Project {
  getProjectRow(id);
  const map: Record<string, string> = {
    name: 'name',
    serverName: 'server_name',
    description: 'description',
    icon: 'icon',
    language: 'language',
    mcVersion: 'mc_version',
    versionChannel: 'version_channel',
    versionVerified: 'version_verified',
    software: 'software',
    softwareBuild: 'software_build',
    templateId: 'template_id',
  };
  const fields: string[] = [];
  const params: any[] = [];
  for (const [key, column] of Object.entries(map)) {
    if (patch[key as keyof typeof patch] === undefined) continue;
    fields.push(`${column} = ?`);
    const value = patch[key as keyof typeof patch];
    if (key === 'versionVerified') params.push(value ? 1 : 0);
    else if (key === 'name' || key === 'serverName') params.push(String(value).trim());
    else params.push(value);
  }
  if (fields.length > 0) {
    fields.push('updated_at = ?');
    params.push(nowIso(), id);
    run(`UPDATE projects SET ${fields.join(', ')} WHERE id = ?`, params);
  }
  return getProject(id);
}

export function touchProject(id: string): void {
  run('UPDATE projects SET updated_at = ? WHERE id = ?', [nowIso(), id]);
}

export function duplicateProject(id: string): Project {
  const source = getProject(id);
  const newProjectId = newId();
  const now = nowIso();
  transaction(() => {
    run(
      `INSERT INTO projects (id, name, server_name, description, icon, language, mc_version, version_channel,
        version_verified, software, software_build, template_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        newProjectId,
        `${source.name} (copy)`,
        source.serverName,
        source.description,
        source.icon,
        source.language,
        source.mcVersion,
        source.versionChannel,
        source.versionVerified ? 1 : 0,
        source.software,
        source.softwareBuild,
        source.templateId,
        now,
        now,
      ],
    );
    const plugins = all<any>('SELECT * FROM project_plugins WHERE project_id = ?', [id]);
    const idMap = new Map<string, string>();
    for (const plugin of plugins) {
      const newPluginId = newId();
      idMap.set(plugin.id, newPluginId);
      run(
        `INSERT INTO project_plugins (id, project_id, library_plugin_id, display_name, version, source, file_name,
          config_dir, status, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [newPluginId, newProjectId, plugin.library_plugin_id, plugin.display_name, plugin.version, plugin.source,
          plugin.file_name, plugin.config_dir, plugin.status, plugin.notes, now, now],
      );
    }
    const configs = all<any>('SELECT * FROM project_configs WHERE project_id = ?', [id]);
    for (const cfg of configs) {
      run(
        `INSERT INTO project_configs (id, project_id, plugin_id, path, format, content, origin, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [newId(), newProjectId, cfg.plugin_id ? idMap.get(cfg.plugin_id) ?? null : null, cfg.path, cfg.format, cfg.content, cfg.origin, now],
      );
    }
  });
  return getProject(newProjectId);
}

export function deleteProject(id: string): void {
  getProjectRow(id);
  run('DELETE FROM projects WHERE id = ?', [id]);
}

function projectCompatibility(project: ProjectRow, library: LibraryPlugin | null): CompatibilityResult {
  if (!library) {
    return {
      level: 'unknown',
      reasons: ['Library metadata for this plugin is no longer available.'],
      label: 'Unknown compatibility',
    };
  }
  const metadata = parseJson<Record<string, unknown>>((get<any>('SELECT metadata FROM library_plugins WHERE id = ?', [library.id]) ?? {}).metadata, {});
  const minMcVersion = typeof metadata.apiVersion === 'string' ? metadata.apiVersion : null;
  return evaluateCompatibility(
    { mcVersions: library.mcVersions, loaders: library.loaders, foliaCompatible: library.foliaCompatible, minMcVersion },
    project.mc_version,
    project.software,
    { versionVerified: Boolean(project.version_verified) },
  );
}

export function listProjectPlugins(projectId: string): ProjectPlugin[] {
  const project = getProjectRow(projectId);
  const rows = all<any>('SELECT * FROM project_plugins WHERE project_id = ? ORDER BY lower(display_name)', [projectId]);
  return rows.map((row) => {
    const libraryRow = row.library_plugin_id
      ? get<any>('SELECT * FROM library_plugins WHERE id = ?', [row.library_plugin_id])
      : null;
    const library = libraryRow ? mapLibraryRow(libraryRow) : null;
    const compatibility = projectCompatibility(project, library);
    let status: 'installed' | 'missing' = row.status;
    if (library && library.fileMissing) status = 'missing';
    if (!library) status = 'missing';
    return {
      id: row.id,
      projectId: row.project_id,
      libraryPluginId: row.library_plugin_id ?? null,
      sourceProjectId: library?.sourceProjectId ?? null,
      sourceSlug: library?.slug ?? null,
      displayName: row.display_name,
      version: row.version ?? null,
      source: row.source,
      fileName: row.file_name,
      configDir: row.config_dir ?? null,
      status,
      notes: row.notes ?? '',
      hasWarnings: compatibility.level !== 'verified',
      compatibility,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });
}

export interface AddPluginResult {
  plugin: ProjectPlugin;
  createdConfigs: string[];
  skippedConfigs: string[];
  warnings: string[];
}

/**
 * Adds a library plugin to a project. Downloads (Modrinth) happen through the
 * validated installer; existing cached files are reused.
 */
export async function addPluginToProject(
  projectId: string,
  input: { libraryPluginId?: string; modrinthProjectId?: string; modrinthVersionId?: string; applyTemplate?: boolean; overwriteConfigs?: boolean },
): Promise<AddPluginResult> {
  const project = getProjectRow(projectId);
  let library: LibraryPlugin | null = input.libraryPluginId ? getLibraryPlugin(input.libraryPluginId) : null;
  const warnings: string[] = [];

  if (!library) {
    const projectRef = input.modrinthProjectId;
    if (!projectRef) throw badRequest('Either libraryPluginId or modrinthProjectId is required.');
    const installed = await installModrinthPlugin({
      projectIdOrSlug: projectRef,
      versionId: input.modrinthVersionId,
      mcVersion: project.mc_version,
      software: project.software,
    });
    library = installed.plugin;
    warnings.push(...installed.warnings);
  }

  const duplicate = get<any>('SELECT id FROM project_plugins WHERE project_id = ? AND lower(display_name) = lower(?)', [
    projectId,
    library.name,
  ]);
  if (duplicate) throw conflict(`"${library.name}" is already in this project.`, { existingId: duplicate.id });

  const libraryMeta = parseJson<Record<string, unknown>>(
    get<any>('SELECT metadata FROM library_plugins WHERE id = ?', [library.id])?.metadata,
    {},
  );
  const configDir =
    (typeof libraryMeta.configDirGuess === 'string' && libraryMeta.configDirGuess.trim()) || inferConfigDir(library.name);
  const now = nowIso();
  const id = newId();
  run(
    `INSERT INTO project_plugins (id, project_id, library_plugin_id, display_name, version, source, file_name,
      config_dir, status, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      projectId,
      library.id,
      library.name,
      library.version,
      library.source,
      library.fileName ?? `${library.name}.jar`,
      configDir,
      library.hasFile ? 'installed' : 'missing',
      '',
      now,
      now,
    ],
  );

  let createdConfigs: string[] = [];
  let skippedConfigs: string[] = [];
  if (input.applyTemplate !== false && library.configTemplateDir) {
    const applied = applyLibraryTemplate(projectId, id, library, {
      overwrite: Boolean(input.overwriteConfigs),
      configDir,
    });
    createdConfigs = applied.created;
    skippedConfigs = applied.skipped;
    if (applied.skipped.length > 0) {
      warnings.push(`${applied.skipped.length} template file(s) already existed and were kept unchanged.`);
    }
  }

  const plugin = listProjectPlugins(projectId).find((p) => p.id === id)!;
  if (plugin.status === 'missing') warnings.push('The plugin file is not available locally. Re-download it before exporting.');
  warnings.push(...plugin.compatibility.reasons.filter((r) => plugin.compatibility.level !== 'verified'));
  touchProject(projectId);
  return { plugin, createdConfigs, skippedConfigs, warnings: Array.from(new Set(warnings)) };
}

export function applyLibraryTemplate(
  projectId: string,
  projectPluginId: string | null,
  library: LibraryPlugin,
  options: { overwrite?: boolean; configDir?: string } = {},
): { created: string[]; skipped: string[] } {
  if (!library.configTemplateDir) return { created: [], skipped: [] };
  const files = listTemplateFiles(library);
  if (files.length === 0) return { created: [], skipped: [] };

  const topLevel = new Set(files.map((f) => (f.includes('/') ? f.split('/')[0] : '')));
  const singleRoot = topLevel.size === 1 && !topLevel.has('');
  const root = singleRoot ? Array.from(topLevel)[0] : null;
  const fallbackDir = options.configDir?.trim() || inferConfigDir(library.name);
  const configDirForPlugin = root ?? fallbackDir;

  const created: string[] = [];
  const skipped: string[] = [];
  for (const file of files) {
    const relative = singleRoot ? file.slice(root!.length + 1) : file;
    const targetPath = `${configDirForPlugin}/${relative}`;
    const existing = get<any>('SELECT id FROM project_configs WHERE project_id = ? AND path = ?', [projectId, targetPath]);
    if (existing && !options.overwrite) {
      skipped.push(targetPath);
      continue;
    }
    const template = readTemplateFile(library, file);
    const now = nowIso();
    if (existing) {
      run('UPDATE project_configs SET content = ?, origin = ?, updated_at = ? WHERE id = ?', [
        template.content,
        'template',
        now,
        existing.id,
      ]);
    } else {
      run(
        `INSERT INTO project_configs (id, project_id, plugin_id, path, format, content, origin, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'template', ?)`,
        [newId(), projectId, projectPluginId, targetPath, formatForConfigPath(targetPath), template.content, now],
      );
    }
    created.push(targetPath);
  }
  return { created, skipped };
}

export function formatForConfigPath(filePath: string): 'yaml' | 'json' | 'toml' | 'text' {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.yml' || ext === '.yaml') return 'yaml';
  if (ext === '.json' || ext === '.mcmeta') return 'json';
  if (ext === '.toml') return 'toml';
  return 'text';
}

export interface ReplacePluginInput {
  libraryPluginId?: string;
  modrinthProjectId?: string;
  modrinthVersionId?: string;
}

/**
 * Replaces the installed version of an existing project plugin while keeping
 * its configuration files (the folder must stay the same plugin).
 */
export async function replaceProjectPlugin(
  projectId: string,
  projectPluginId: string,
  input: ReplacePluginInput,
): Promise<{ plugin: ProjectPlugin; warnings: string[] }> {
  const project = getProjectRow(projectId);
  const row = get<any>('SELECT * FROM project_plugins WHERE id = ? AND project_id = ?', [projectPluginId, projectId]);
  if (!row) throw notFound('Plugin is not part of this project.');
  const previousLibrary = row.library_plugin_id ? getLibraryPlugin(row.library_plugin_id) : null;

  let library: LibraryPlugin | null = input.libraryPluginId ? getLibraryPlugin(input.libraryPluginId) : null;
  const warnings: string[] = [];
  if (!library && input.modrinthProjectId) {
    const installed = await installModrinthPlugin({
      projectIdOrSlug: input.modrinthProjectId,
      versionId: input.modrinthVersionId,
      mcVersion: project.mc_version,
      software: project.software,
    });
    library = installed.plugin;
    warnings.push(...installed.warnings);
  }
  if (!library) throw badRequest('A target library entry or Modrinth project is required.');

  const samePlugin =
    library.name.toLowerCase() === String(row.display_name).toLowerCase() ||
    Boolean(previousLibrary?.sourceProjectId && library.sourceProjectId && previousLibrary.sourceProjectId === library.sourceProjectId);
  if (!samePlugin) {
    throw badRequest(`Version replacement must target the same plugin (${row.display_name}). Remove it and add a different plugin instead.`);
  }
  if (library.id === row.library_plugin_id) throw conflict('This project already uses that plugin version.');

  const other = get<any>('SELECT id FROM project_plugins WHERE project_id = ? AND lower(display_name) = lower(?) AND id <> ?', [
    projectId,
    library.name,
    projectPluginId,
  ]);
  if (other) throw conflict(`"${library.name}" already exists in this project under another entry.`);

  run(
    `UPDATE project_plugins SET library_plugin_id = ?, display_name = ?, version = ?, source = ?, file_name = ?,
      status = ?, updated_at = ? WHERE id = ?`,
    [
      library.id,
      library.name,
      library.version,
      library.source,
      library.fileName ?? row.file_name,
      library.hasFile ? 'installed' : 'missing',
      nowIso(),
      projectPluginId,
    ],
  );
  touchProject(projectId);
  const plugin = listProjectPlugins(projectId).find((item) => item.id === projectPluginId)!;
  return { plugin, warnings: Array.from(new Set(warnings)) };
}

/** Resolves missing required dependencies that name a Modrinth project. */
export async function resolveProjectDependencies(projectId: string): Promise<{
  installed: { name: string; forPlugin: string }[];
  failed: { name: string; reason: string }[];
  remaining: ReturnType<typeof projectDependencies>;
}> {
  const project = getProjectRow(projectId);
  const missing = projectDependencies(projectId).missing.filter((dep) => dep.projectId);
  const installed: { name: string; forPlugin: string }[] = [];
  const failed: { name: string; reason: string }[] = [];
  const seen = new Set<string>();

  for (const dep of missing) {
    if (!dep.projectId || seen.has(dep.projectId)) continue;
    seen.add(dep.projectId);
    try {
      const result = await addPluginToProject(projectId, { modrinthProjectId: dep.projectId });
      installed.push({ name: result.plugin.displayName, forPlugin: dep.forPlugin });
    } catch (err: any) {
      failed.push({ name: dep.name, reason: err?.message ?? 'Unknown error' });
    }
  }
  void project;
  return { installed, failed, remaining: projectDependencies(projectId) };
}

export function reinstallProjectPlugin(projectId: string, projectPluginId: string): ProjectPlugin {
  const row = get<any>('SELECT * FROM project_plugins WHERE id = ? AND project_id = ?', [projectPluginId, projectId]);
  if (!row) throw notFound('Plugin is not part of this project.');
  const library = row.library_plugin_id ? getLibraryPlugin(row.library_plugin_id) : null;
  if (!library) throw conflict('This project plugin has no library entry to reinstall from.');
  if (!library.hasFile) throw conflict('Library file is missing; download the plugin again from its source.');
  run('UPDATE project_plugins SET status = ?, file_name = ?, updated_at = ? WHERE id = ?', [
    'installed',
    library.fileName ?? row.file_name,
    nowIso(),
    projectPluginId,
  ]);
  touchProject(projectId);
  return listProjectPlugins(projectId).find((p) => p.id === projectPluginId)!;
}

export function removePluginFromProject(projectId: string, projectPluginId: string, options: { deleteConfigs?: boolean } = {}): void {
  const row = get<any>('SELECT * FROM project_plugins WHERE id = ? AND project_id = ?', [projectPluginId, projectId]);
  if (!row) throw notFound('Plugin is not part of this project.');
  transaction(() => {
    if (options.deleteConfigs && row.config_dir) {
      run('DELETE FROM project_configs WHERE project_id = ? AND path LIKE ?', [projectId, `${row.config_dir}/%`]);
    } else {
      run('UPDATE project_configs SET plugin_id = NULL WHERE project_id = ? AND plugin_id = ?', [projectId, projectPluginId]);
    }
    run('DELETE FROM project_plugins WHERE id = ?', [projectPluginId]);
  });
  touchProject(projectId);
}

export function projectDependencies(projectId: string): {
  missing: { name: string; kind: string; projectId?: string; forPlugin: string; libraryId?: string }[];
  resolved: { name: string; forPlugin: string }[];
} {
  const project = getProjectRow(projectId);
  const plugins = listProjectPlugins(projectId);
  const projectSourceIds = new Set<string>();
  const projectNames = new Set<string>();
  for (const plugin of plugins) {
    projectNames.add(plugin.displayName.toLowerCase());
    const library = plugin.libraryPluginId ? getLibraryPlugin(plugin.libraryPluginId) : null;
    if (library?.sourceProjectId) projectSourceIds.add(library.sourceProjectId);
  }
  const missing: { name: string; kind: string; projectId?: string; forPlugin: string; libraryId?: string }[] = [];
  const resolved: { name: string; forPlugin: string }[] = [];
  for (const plugin of plugins) {
    if (!plugin.libraryPluginId) continue;
    const library = getLibraryPlugin(plugin.libraryPluginId);
    if (!library) continue;
    for (const dep of library.dependencies) {
      if (dep.kind !== 'required') continue;
      const depName = dep.name ?? dep.projectId ?? 'unknown dependency';
      const satisfied =
        (dep.projectId && projectSourceIds.has(dep.projectId)) ||
        (dep.name && projectNames.has(dep.name.replace(/\.jar$/i, '').toLowerCase())) ||
        false;
      if (satisfied) resolved.push({ name: depName, forPlugin: plugin.displayName });
      else
        missing.push({
          name: depName,
          kind: dep.kind,
          projectId: dep.projectId,
          forPlugin: plugin.displayName,
        });
    }
  }
  return { missing, resolved };
}

export interface ProjectSummary {
  warnings: { plugin: string; level: string; reasons: string[] }[];
  dependencyIssues: ReturnType<typeof projectDependencies>['missing'];
  missingFiles: string[];
  compatibility: CompatibilityResult;
}

export function projectSummary(projectId: string): ProjectSummary {
  const plugins = listProjectPlugins(projectId);
  const deps = projectDependencies(projectId);
  return {
    warnings: plugins
      .filter((p) => p.compatibility.level !== 'verified')
      .map((p) => ({ plugin: p.displayName, level: p.compatibility.level, reasons: p.compatibility.reasons })),
    dependencyIssues: deps.missing,
    missingFiles: plugins.filter((p) => p.status === 'missing').map((p) => p.displayName),
    compatibility: worstCompatibility(plugins.map((p) => p.compatibility)),
  };
}

/* ----------------------------- configuration files ----------------------------- */

export function listProjectConfigs(projectId: string): ProjectConfig[] {
  getProjectRow(projectId);
  return all<any>('SELECT * FROM project_configs WHERE project_id = ? ORDER BY path', [projectId]).map(mapConfigRow);
}

function mapConfigRow(row: any): ProjectConfig {
  return {
    id: row.id,
    projectId: row.project_id,
    pluginId: row.plugin_id ?? null,
    path: row.path,
    format: row.format,
    content: row.content,
    origin: row.origin,
    updatedAt: row.updated_at,
  };
}

export function getProjectConfig(projectId: string, configId: string): ProjectConfig {
  const row = get<any>('SELECT * FROM project_configs WHERE id = ? AND project_id = ?', [configId, projectId]);
  if (!row) throw notFound('Configuration file not found.');
  return mapConfigRow(row);
}

export function normalizeConfigPath(input: string): string {
  const normalized = input.replace(/\\/g, '/').replace(/^\/+/, '').replace(/^plugins\//i, '');
  if (!normalized || normalized.endsWith('/')) throw badRequest('Configuration path must point to a file.');
  if (normalized.split('/').some((part) => part === '..' || part === '' || part === '.')) {
    throw badRequest('Configuration path contains invalid segments.');
  }
  if (normalized.length > 300) throw badRequest('Configuration path is too long.');
  return normalized;
}

export function validateConfigContent(format: string, content: string): { valid: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (content.length > 2 * 1024 * 1024) errors.push('File is larger than the 2 MiB editor limit.');
  if (format === 'yaml') {
    try {
      parseYamlSafe(content);
    } catch (err: any) {
      errors.push(err?.message ?? 'Invalid YAML');
    }
    if (/\t/.test(content)) warnings.push('YAML should use spaces, not tabs, for indentation.');
  } else if (format === 'json') {
    try {
      JSON.parse(content);
    } catch (err: any) {
      errors.push(err?.message ?? 'Invalid JSON');
    }
  } else if (format === 'toml') {
    try {
      parseToml(content);
    } catch (err: any) {
      errors.push(err?.message ?? 'Invalid TOML');
    }
  } else if (format === 'text') {
    if (content.includes('\0')) errors.push('File contains binary null bytes.');
  }
  return { valid: errors.length === 0, errors, warnings };
}

export function upsertProjectConfig(
  projectId: string,
  input: { path: string; content: string; format?: string; pluginId?: string | null; origin?: ProjectConfig['origin'] },
): ProjectConfig {
  getProjectRow(projectId);
  const configPath = normalizeConfigPath(input.path);
  const format = input.format ?? formatForConfigPath(configPath);
  const validation = validateConfigContent(format, input.content);
  if (!validation.valid) throw badRequest('Configuration content is invalid.', validation.errors);
  const now = nowIso();
  const existing = get<any>('SELECT id FROM project_configs WHERE project_id = ? AND path = ?', [projectId, configPath]);
  if (existing) {
    run('UPDATE project_configs SET content = ?, format = ?, origin = ?, plugin_id = COALESCE(?, plugin_id), updated_at = ? WHERE id = ?', [
      input.content,
      format,
      input.origin ?? 'user',
      input.pluginId ?? null,
      now,
      existing.id,
    ]);
    touchProject(projectId);
    return getProjectConfig(projectId, existing.id);
  }
  const id = newId();
  run(
    `INSERT INTO project_configs (id, project_id, plugin_id, path, format, content, origin, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, projectId, input.pluginId ?? null, configPath, format, input.content, input.origin ?? 'user', now],
  );
  touchProject(projectId);
  return getProjectConfig(projectId, id);
}

export function deleteProjectConfig(projectId: string, configId: string): void {
  getProjectConfig(projectId, configId);
  run('DELETE FROM project_configs WHERE id = ? AND project_id = ?', [configId, projectId]);
  touchProject(projectId);
}

export function resetProjectConfig(projectId: string, configId: string, content: string, origin: ProjectConfig['origin'] = 'template'): ProjectConfig {
  const existing = getProjectConfig(projectId, configId);
  const validation = validateConfigContent(existing.format, content);
  if (!validation.valid) throw badRequest('Template content is invalid.', validation.errors);
  run('UPDATE project_configs SET content = ?, origin = ?, updated_at = ? WHERE id = ?', [content, origin, nowIso(), configId]);
  touchProject(projectId);
  return getProjectConfig(projectId, configId);
}

export function findConfigTemplateContent(projectId: string, configId: string): { content: string; source: string } | null {
  const config = getProjectConfig(projectId, configId);
  const plugins = listProjectPlugins(projectId).filter((p) => p.configDir && config.path.startsWith(`${p.configDir}/`));
  for (const plugin of plugins) {
    if (!plugin.libraryPluginId) continue;
    const library = getLibraryPlugin(plugin.libraryPluginId);
    if (!library?.configTemplateDir) continue;
    const files = listTemplateFiles(library);
    const suffix = config.path.slice((plugin.configDir ?? '').length + 1);
    const match = files.find((f) => f === suffix || f.endsWith(`/${suffix}`));
    if (match) return { content: readTemplateFile(library, match).content, source: library.name };
  }
  return null;
}

export function projectFileMap(projectId: string): {
  entries: { path: string; size: number; plugin: string }[];
  missing: string[];
} {
  const plugins = listProjectPlugins(projectId);
  const entries: { path: string; size: number; plugin: string }[] = [];
  const missing: string[] = [];
  const configs = listProjectConfigs(projectId);

  for (const plugin of plugins) {
    const library = plugin.libraryPluginId ? getLibraryPlugin(plugin.libraryPluginId) : null;
    if (!library || !library.hasFile || !library.fileName) {
      missing.push(plugin.displayName);
      continue;
    }
    const row = get<any>('SELECT file_path FROM library_plugins WHERE id = ?', [library.id]);
    if (!row?.file_path) {
      missing.push(plugin.displayName);
      continue;
    }
    const stat = fs.statSync(fromStorageRoot(row.file_path));
    entries.push({ path: `plugins/${library.fileName}`, size: stat.size, plugin: plugin.displayName });
  }
  for (const config of configs) {
    entries.push({
      path: `plugins/${normalizeConfigPath(config.path)}`,
      size: Buffer.byteLength(config.content, 'utf8'),
      plugin: plugins.find((p) => p.configDir && config.path.startsWith(`${p.configDir}/`))?.displayName ?? 'Project files',
    });
  }
  return { entries, missing };
}
