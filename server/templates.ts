import { get, all, newId, nowIso, parseJson, run } from './db.js';
import { evaluateCompatibility } from './compat.js';
import { getLibraryPlugin } from './library.js';
import { installModrinthPlugin } from './installer.js';
import { addPluginToProject, getProjectRow, listProjectPlugins, touchProject } from './projects.js';
import { badRequest, conflict, notFound } from './util.js';
import type { ServerSoftware, ServerTemplate, TemplatePluginRef } from '../shared/types.js';

function mapTemplateRow(row: any): ServerTemplate {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    categories: parseJson<string[]>(row.categories, []),
    mcVersions: parseJson<string[]>(row.mc_versions, []),
    software: (row.software as ServerSoftware | null) ?? null,
    plugins: parseJson<TemplatePluginRef[]>(row.plugins, []),
    warnings: parseJson<string[]>(row.warnings, []),
    notes: row.notes ?? '',
    builtin: Boolean(row.builtin),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listTemplates(): ServerTemplate[] {
  return all<any>('SELECT * FROM templates ORDER BY builtin DESC, lower(name)').map(mapTemplateRow);
}

export function getTemplate(id: string): ServerTemplate {
  const row = get<any>('SELECT * FROM templates WHERE id = ?', [id]);
  if (!row) throw notFound('Server setup template not found.');
  return mapTemplateRow(row);
}

export interface TemplatePluginResolution {
  ref: TemplatePluginRef;
  status: 'available-local' | 'available-modrinth' | 'in-project' | 'unavailable';
  libraryPluginId: string | null;
  libraryName: string | null;
  version: string | null;
  compatibility: { level: string; reasons: string[] };
}

export interface TemplatePreview {
  template: ServerTemplate;
  plugins: TemplatePluginResolution[];
  warnings: string[];
  availableCount: number;
  unavailableCount: number;
}

/** Resolves template plugin references against the local library only (no downloads). */
export function previewTemplate(id: string, projectId?: string): TemplatePreview {
  const template = getTemplate(id);
  const project = projectId ? getProjectRow(projectId) : null;
  const inProject = projectId ? new Set(listProjectPlugins(projectId).map((p) => p.displayName.toLowerCase())) : new Set<string>();
  const plugins: TemplatePluginResolution[] = template.plugins.map((ref) => {
    const local = findLocalMatch(ref);
    const compat = project && local
      ? evaluateCompatibility(
          { mcVersions: local.mcVersions, loaders: local.loaders, foliaCompatible: local.foliaCompatible },
          project.mc_version,
          project.software,
          { versionVerified: Boolean(project.version_verified) },
        )
      : { level: 'unknown', reasons: ['No project selected; compatibility is evaluated when the template is applied.'] };
    if (inProject.has(ref.name.toLowerCase())) {
      return {
        ref,
        status: 'in-project',
        libraryPluginId: local?.id ?? null,
        libraryName: local?.name ?? null,
        version: local?.version ?? null,
        compatibility: { level: compat.level, reasons: compat.reasons },
      };
    }
    return {
      ref,
      status: local ? 'available-local' : ref.modrinthSlug ? 'available-modrinth' : 'unavailable',
      libraryPluginId: local?.id ?? null,
      libraryName: local?.name ?? null,
      version: local?.version ?? null,
      compatibility: { level: compat.level, reasons: compat.reasons },
    };
  });

  const warnings = [
    ...template.warnings,
    ...(project && project.software === 'folia'
      ? ['Folia runs plugins in region threads: every plugin must be evaluated individually for Folia support.']
      : []),
    ...plugins
      .filter((p) => p.ref.required && p.status === 'unavailable')
      .map((p) => `Required plugin "${p.ref.name}" is not in the local library. Download it from Modrinth or upload it first.`),
    ...plugins
      .filter((p) => p.compatibility.level === 'incompatible')
      .map((p) => `"${p.ref.name}" is reported incompatible with the project's server version/software.`),
  ];

  return {
    template,
    plugins,
    warnings: Array.from(new Set(warnings)),
    availableCount: plugins.filter((p) => p.status !== 'unavailable').length,
    unavailableCount: plugins.filter((p) => p.status === 'unavailable').length,
  };
}

function findLocalMatch(ref: TemplatePluginRef) {
  const slug = (ref.modrinthSlug || ref.slug || '').toLowerCase();
  const candidates = all<any>('SELECT * FROM library_plugins ORDER BY created_at DESC');
  const match = candidates.find((row) => {
    const name = String(row.name).toLowerCase();
    const rowSlug = String(row.slug ?? '').toLowerCase();
    return name === ref.name.toLowerCase() || (slug !== '' && (rowSlug === slug || name.replace(/\s+/g, '') === slug));
  });
  return match ? getLibraryPlugin(match.id) : null;
}

export interface ApplyTemplateOptions {
  projectId: string;
  installMissing?: boolean;
  overwriteConfigs?: boolean;
}

export interface ApplyTemplateResult {
  added: { name: string; libraryPluginId: string }[];
  skipped: { name: string; reason: string }[];
  failed: { name: string; reason: string }[];
  warnings: string[];
}

/**
 * Applies a template to a project: reuses local library entries, optionally
 * downloads missing plugins through the validated Modrinth installer, and never
 * overwrites existing configuration files unless explicitly requested.
 */
export async function applyTemplateToProject(templateId: string, options: ApplyTemplateOptions): Promise<ApplyTemplateResult> {
  const template = getTemplate(templateId);
  const project = getProjectRow(options.projectId);
  const added: ApplyTemplateResult['added'] = [];
  const skipped: ApplyTemplateResult['skipped'] = [];
  const failed: ApplyTemplateResult['failed'] = [];
  const warnings: string[] = [];

  for (const ref of template.plugins) {
    try {
      const existing = listProjectPlugins(project.id).find((p) => p.displayName.toLowerCase() === ref.name.toLowerCase());
      if (existing) {
        skipped.push({ name: ref.name, reason: 'Already installed in this project.' });
        continue;
      }
      let local = findLocalMatch(ref);
      if (!local && options.installMissing) {
        if (!ref.modrinthSlug) {
          skipped.push({ name: ref.name, reason: 'No Modrinth slug is defined for this reference.' });
          continue;
        }
        const installed = await installModrinthPlugin({
          projectIdOrSlug: ref.modrinthSlug,
          mcVersion: project.mc_version,
          software: project.software,
        });
        local = installed.plugin;
        warnings.push(...installed.warnings);
      }
      if (!local) {
        skipped.push({
          name: ref.name,
          reason: ref.required
            ? 'Required plugin is not available locally. Enable "download missing" or upload it first.'
            : 'Optional plugin is not available locally.',
        });
        continue;
      }
      const result = await addPluginToProject(project.id, {
        libraryPluginId: local.id,
        overwriteConfigs: options.overwriteConfigs,
      });
      added.push({ name: result.plugin.displayName, libraryPluginId: local.id });
      warnings.push(...result.warnings);
      if (result.skippedConfigs.length > 0) {
        warnings.push(`${result.plugin.displayName}: kept ${result.skippedConfigs.length} existing config file(s).`);
      }
    } catch (err: any) {
      failed.push({ name: ref.name, reason: err?.message ?? 'Unknown error' });
    }
  }

  if (template.id) {
    run('UPDATE projects SET template_id = ?, updated_at = ? WHERE id = ?', [template.id, nowIso(), project.id]);
  }
  touchProject(project.id);
  return { added, skipped, failed, warnings: Array.from(new Set(warnings)) };
}

export interface TemplateInput {
  name: string;
  description?: string;
  categories?: string[];
  mcVersions?: string[];
  software?: ServerSoftware | null;
  plugins?: TemplatePluginRef[];
  warnings?: string[];
  notes?: string;
}

export function createTemplate(input: TemplateInput): ServerTemplate {
  const id = newId();
  const now = nowIso();
  run(
    `INSERT INTO templates (id, name, description, categories, mc_versions, software, plugins, warnings, notes, builtin, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    [
      id,
      input.name.trim(),
      input.description ?? '',
      JSON.stringify(input.categories ?? []),
      JSON.stringify(input.mcVersions ?? []),
      input.software ?? null,
      JSON.stringify(input.plugins ?? []),
      JSON.stringify(input.warnings ?? []),
      input.notes ?? '',
      now,
      now,
    ],
  );
  return getTemplate(id);
}

export function updateTemplate(id: string, input: Partial<TemplateInput>): ServerTemplate {
  const existing = getTemplate(id);
  if (existing.builtin) throw conflict('Built-in templates cannot be edited. Duplicate the template first.');
  const fields: string[] = [];
  const params: any[] = [];
  const set = (column: string, value: unknown) => {
    fields.push(`${column} = ?`);
    params.push(value);
  };
  if (input.name !== undefined) set('name', input.name.trim());
  if (input.description !== undefined) set('description', input.description);
  if (input.categories !== undefined) set('categories', JSON.stringify(input.categories));
  if (input.mcVersions !== undefined) set('mc_versions', JSON.stringify(input.mcVersions));
  if (input.software !== undefined) set('software', input.software);
  if (input.plugins !== undefined) set('plugins', JSON.stringify(input.plugins));
  if (input.warnings !== undefined) set('warnings', JSON.stringify(input.warnings));
  if (input.notes !== undefined) set('notes', input.notes);
  if (fields.length === 0) return existing;
  set('updated_at', nowIso());
  run(`UPDATE templates SET ${fields.join(', ')} WHERE id = ?`, [...params, id]);
  return getTemplate(id);
}

export function duplicateTemplate(id: string, name?: string): ServerTemplate {
  const existing = getTemplate(id);
  return createTemplate({
    name: name?.trim() || `${existing.name} (copy)`,
    description: existing.description,
    categories: existing.categories,
    mcVersions: existing.mcVersions,
    software: existing.software,
    plugins: existing.plugins,
    warnings: existing.warnings,
    notes: existing.notes,
  });
}

export function deleteTemplate(id: string): void {
  const existing = getTemplate(id);
  if (existing.builtin) throw conflict('Built-in templates cannot be deleted.');
  run('DELETE FROM templates WHERE id = ?', [id]);
  run('UPDATE projects SET template_id = NULL WHERE template_id = ?', [id]);
}

/** Builds a reusable template from a project's current plugin set. */
export function templateFromProject(projectId: string, input: { name: string; description?: string }): ServerTemplate {
  const project = getProjectRow(projectId);
  const plugins = listProjectPlugins(projectId);
  if (plugins.length === 0) throw badRequest('Add at least one plugin before creating a template from this project.');
  const refs: TemplatePluginRef[] = plugins.map((plugin) => {
    const library = plugin.libraryPluginId ? getLibraryPlugin(plugin.libraryPluginId) : null;
    return {
      name: plugin.displayName,
      slug: library?.slug ?? undefined,
      modrinthSlug: library?.source === 'modrinth' ? library.slug ?? undefined : undefined,
      required: true,
      note: plugin.notes || undefined,
      versionConstraint: plugin.version ?? undefined,
    };
  });
  return createTemplate({
    name: input.name.trim(),
    description: input.description ?? `Captured from project "${project.name}".`,
    categories: Array.from(new Set(plugins.map((p) => p.configDir ?? 'Other'))),
    mcVersions: [project.mc_version],
    software: project.software,
    plugins: refs,
    warnings: [`Captured from ${project.server_name} running ${project.software} ${project.mc_version}.`],
    notes: 'Plugin versions were captured from the source project; verify compatibility before reuse.',
  });
}
