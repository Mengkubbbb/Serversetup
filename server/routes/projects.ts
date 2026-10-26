import fs from 'node:fs';
import { Router } from 'express';
import { z } from 'zod';
import { upload } from '../upload.js';
import { asyncHandler, badRequest, notFound, parseWith, rateLimit } from '../util.js';
import {
  addPluginToProject,
  createProject,
  deleteProject,
  deleteProjectConfig,
  duplicateProject,
  findConfigTemplateContent,
  getProject,
  getProjectConfig,
  getProjectRow,
  listProjectConfigs,
  listProjectPlugins,
  listProjects,
  normalizeConfigPath,
  projectDependencies,
  projectSummary,
  reinstallProjectPlugin,
  removePluginFromProject,
  replaceProjectPlugin,
  resolveProjectDependencies,
  resetProjectConfig,
  touchProject,
  updateProject,
  upsertProjectConfig,
  validateConfigContent,
  formatForConfigPath,
} from '../projects.js';
import { getMinecraftVersions, isValidMinecraftVersion } from '../mcmeta.js';
import { buildExportPreview, createExportArchive } from '../export.js';

export const projectsRouter = Router();

const languageSchema = z.enum(['en', 'th']);
const softwareSchema = z.enum(['paper', 'folia', 'leaf']);
const versionSchema = z.string().trim().min(2).max(40);

const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(80),
  serverName: z.string().trim().min(1).max(80),
  language: languageSchema.default('en'),
  description: z.string().max(2000).optional().default(''),
  icon: z.string().max(200_000).nullable().optional(),
  mcVersion: versionSchema,
  software: softwareSchema,
  softwareBuild: z.string().trim().max(60).nullable().optional(),
  templateId: z.string().uuid().nullable().optional(),
});

async function resolveVersionMetadata(version: string): Promise<{ verified: boolean; channel: 'release' | 'prerelease' | 'snapshot' | 'custom'; warning?: string }> {
  const { versions, warning } = await getMinecraftVersions();
  const match = versions.find((v) => v.id === version);
  if (!match) {
    return { verified: false, channel: 'custom', warning: warning ?? `Minecraft ${version} is not in the official version manifest; treating it as a custom version.` };
  }
  return {
    verified: true,
    channel: match.type === 'release' ? 'release' : match.type === 'snapshot' ? 'snapshot' : 'prerelease',
  };
}

projectsRouter.get(
  '/',
  asyncHandler((_req, res) => {
    res.json({ projects: listProjects() });
  }),
);

projectsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = parseWith(createProjectSchema, req.body);
    if (!isValidMinecraftVersion(input.mcVersion)) {
      throw badRequest('Invalid Minecraft version format. Use something like 1.21.4, 26.3 or 26.4-snapshot-1.');
    }
    const meta = await resolveVersionMetadata(input.mcVersion);
    const project = createProject({
      name: input.name,
      serverName: input.serverName,
      language: (input.language ?? 'en') as 'en' | 'th',
      description: input.description,
      icon: input.icon ?? null,
      mcVersion: input.mcVersion,
      versionChannel: meta.channel,
      versionVerified: meta.verified,
      software: input.software,
      softwareBuild: input.softwareBuild ?? null,
      templateId: input.templateId ?? null,
    });
    res.status(201).json({ project, versionWarning: meta.warning });
  }),
);

projectsRouter.get(
  '/:id',
  asyncHandler((req, res) => {
    const project = getProject(req.params.id);
    res.json({
      project,
      plugins: listProjectPlugins(project.id),
      configs: listProjectConfigs(project.id),
      summary: projectSummary(project.id),
      dependencies: projectDependencies(project.id),
    });
  }),
);

const patchProjectSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  serverName: z.string().trim().min(1).max(80).optional(),
  description: z.string().max(2000).optional(),
  icon: z.string().max(200_000).nullable().optional(),
  language: languageSchema.optional(),
  mcVersion: versionSchema.optional(),
  software: softwareSchema.optional(),
  softwareBuild: z.string().trim().max(60).nullable().optional(),
  templateId: z.string().uuid().nullable().optional(),
});

projectsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const patch = parseWith(patchProjectSchema, req.body);
    let versionMeta: { verified: boolean; channel: any } | null = null;
    if (patch.mcVersion) {
      if (!isValidMinecraftVersion(patch.mcVersion)) {
        throw badRequest('Invalid Minecraft version format. Use something like 1.21.4, 26.3 or 26.4-snapshot-1.');
      }
      versionMeta = await resolveVersionMetadata(patch.mcVersion);
    }
    const project = updateProject(req.params.id, {
      ...patch,
      ...(versionMeta ? { versionChannel: versionMeta.channel, versionVerified: versionMeta.verified } : {}),
    });
    res.json({ project, plugins: listProjectPlugins(project.id), summary: projectSummary(project.id) });
  }),
);

projectsRouter.delete(
  '/:id',
  asyncHandler((req, res) => {
    deleteProject(req.params.id);
    res.status(204).end();
  }),
);

projectsRouter.post(
  '/:id/duplicate',
  asyncHandler((req, res) => {
    const project = duplicateProject(req.params.id);
    res.status(201).json({ project });
  }),
);

/* ----------------------------------- plugins ---------------------------------- */

projectsRouter.get(
  '/:id/plugins',
  asyncHandler((req, res) => {
    getProjectRow(req.params.id);
    res.json({
      plugins: listProjectPlugins(req.params.id),
      dependencies: projectDependencies(req.params.id),
    });
  }),
);

const addPluginSchema = z
  .object({
    libraryPluginId: z.string().uuid().optional(),
    modrinthProjectId: z.string().trim().max(64).optional(),
    modrinthVersionId: z.string().trim().max(64).optional(),
    applyTemplate: z.boolean().optional().default(true),
    overwriteConfigs: z.boolean().optional().default(false),
  })
  .refine((v) => Boolean(v.libraryPluginId || v.modrinthProjectId), {
    message: 'Provide a library plugin id or a Modrinth project id.',
  });

const pluginInstallLimiter = rateLimit('plugin-install', 30, 60_000);

projectsRouter.post(
  '/:id/plugins',
  pluginInstallLimiter,
  asyncHandler(async (req, res) => {
    const input = parseWith(addPluginSchema, req.body);
    getProjectRow(req.params.id);
    const result = await addPluginToProject(req.params.id, input);
    res.status(201).json(result);
  }),
);

const batchSchema = z.object({
  items: z
    .array(
      z
        .object({
          libraryPluginId: z.string().uuid().optional(),
          modrinthProjectId: z.string().trim().max(64).optional(),
          modrinthVersionId: z.string().trim().max(64).optional(),
          name: z.string().max(120).optional(),
        })
        .refine((v) => Boolean(v.libraryPluginId || v.modrinthProjectId), { message: 'Each item needs a plugin reference.' }),
    )
    .min(1)
    .max(30),
  allowIncompatible: z.boolean().optional().default(false),
  overwriteConfigs: z.boolean().optional().default(false),
});

projectsRouter.post(
  '/:id/plugins/batch',
  pluginInstallLimiter,
  asyncHandler(async (req, res) => {
    const input = parseWith(batchSchema, req.body);
    const project = getProjectRow(req.params.id);
    const results: any[] = [];
    for (const item of input.items) {
      try {
        const result = await addPluginToProject(req.params.id, {
          ...item,
          overwriteConfigs: input.overwriteConfigs,
        });
        if (
          !input.allowIncompatible &&
          result.plugin.compatibility.level === 'incompatible'
        ) {
          removePluginFromProject(req.params.id, result.plugin.id, { deleteConfigs: true });
          results.push({
            name: item.name ?? result.plugin.displayName,
            status: 'rejected',
            error: `Incompatible with ${project.software} ${project.mc_version}: ${result.plugin.compatibility.reasons.join(' ')}`,
          });
          continue;
        }
        results.push({
          name: result.plugin.displayName,
          status: 'installed',
          plugin: result.plugin,
          warnings: result.warnings,
          createdConfigs: result.createdConfigs,
          skippedConfigs: result.skippedConfigs,
        });
      } catch (err: any) {
        results.push({
          name: item.name ?? item.modrinthProjectId ?? item.libraryPluginId ?? 'plugin',
          status: 'failed',
          error: err?.message ?? 'Install failed',
          details: err?.details,
        });
      }
    }
    touchProject(req.params.id);
    const pluginList = listProjectPlugins(req.params.id);
    res.json({
      results,
      plugins: pluginList,
      summary: projectSummary(req.params.id),
      installed: results.filter((r) => r.status === 'installed').length,
      failed: results.filter((r) => r.status !== 'installed').length,
    });
  }),
);

const patchPluginSchema = z.object({
  notes: z.string().max(2000).optional(),
});

projectsRouter.patch(
  '/:id/plugins/:pluginId',
  asyncHandler(async (req, res) => {
    const { notes } = parseWith(patchPluginSchema, req.body);
    const plugin = listProjectPlugins(req.params.id).find((p) => p.id === req.params.pluginId);
    if (!plugin) throw notFound('Plugin is not part of this project.');
    const { run } = await import('../db.js');
    run('UPDATE project_plugins SET notes = ?, updated_at = ? WHERE id = ?', [notes ?? '', new Date().toISOString(), plugin.id]);
    touchProject(req.params.id);
    res.json({ plugin: listProjectPlugins(req.params.id).find((p) => p.id === plugin.id) });
  }),
);

projectsRouter.post(
  '/:id/plugins/:pluginId/reinstall',
  asyncHandler((req, res) => {
    const plugin = reinstallProjectPlugin(req.params.id, req.params.pluginId);
    res.json({ plugin });
  }),
);

projectsRouter.delete(
  '/:id/plugins/:pluginId',
  asyncHandler((req, res) => {
    const deleteConfigs = req.query.deleteConfigs === 'true';
    removePluginFromProject(req.params.id, req.params.pluginId, { deleteConfigs });
    res.json({ plugins: listProjectPlugins(req.params.id), summary: projectSummary(req.params.id) });
  }),
);

const replacePluginSchema = z
  .object({
    libraryPluginId: z.string().uuid().optional(),
    modrinthProjectId: z.string().trim().max(64).optional(),
    modrinthVersionId: z.string().trim().max(64).optional(),
  })
  .refine((value) => Boolean(value.libraryPluginId || value.modrinthProjectId), {
    message: 'Provide a library plugin id or a Modrinth project id.',
  });

projectsRouter.post(
  '/:id/plugins/:pluginId/replace',
  rateLimit('plugin-install', 30, 60_000),
  asyncHandler(async (req, res) => {
    const input = parseWith(replacePluginSchema, req.body);
    const result = await replaceProjectPlugin(req.params.id, req.params.pluginId, input);
    res.json({ ...result, summary: projectSummary(req.params.id) });
  }),
);

projectsRouter.post(
  '/:id/plugins/resolve-dependencies',
  rateLimit('plugin-install', 30, 60_000),
  asyncHandler(async (req, res) => {
    getProjectRow(req.params.id);
    const result = await resolveProjectDependencies(req.params.id);
    res.json({ ...result, plugins: listProjectPlugins(req.params.id), summary: projectSummary(req.params.id) });
  }),
);

projectsRouter.get(
  '/:id/dependencies',
  asyncHandler((req, res) => {
    getProjectRow(req.params.id);
    res.json(projectDependencies(req.params.id));
  }),
);

projectsRouter.get(
  '/:id/compatibility',
  asyncHandler((req, res) => {
    getProjectRow(req.params.id);
    res.json({ summary: projectSummary(req.params.id), plugins: listProjectPlugins(req.params.id).map((p) => ({ id: p.id, name: p.displayName, compatibility: p.compatibility })) });
  }),
);

/* -------------------------------- configuration ------------------------------- */

const configSchema = z.object({
  path: z.string().trim().min(3).max(300),
  content: z.string().max(2 * 1024 * 1024),
  format: z.enum(['yaml', 'json', 'toml', 'text']).optional(),
  pluginId: z.string().uuid().nullable().optional(),
  origin: z.enum(['user', 'template', 'imported', 'generated']).optional(),
});

projectsRouter.get(
  '/:id/configs',
  asyncHandler((req, res) => {
    getProjectRow(req.params.id);
    res.json({ configs: listProjectConfigs(req.params.id) });
  }),
);

projectsRouter.post(
  '/:id/configs',
  asyncHandler((req, res) => {
    const input = parseWith(configSchema, req.body);
    const config = upsertProjectConfig(req.params.id, input);
    res.status(201).json({ config });
  }),
);

projectsRouter.get(
  '/:id/configs/:configId',
  asyncHandler((req, res) => {
    res.json({ config: getProjectConfig(req.params.id, req.params.configId) });
  }),
);

projectsRouter.put(
  '/:id/configs/:configId',
  asyncHandler((req, res) => {
    const input = parseWith(configSchema.pick({ content: true, format: true }), req.body);
    const existing = getProjectConfig(req.params.id, req.params.configId);
    const config = upsertProjectConfig(req.params.id, {
      path: existing.path,
      content: input.content,
      format: input.format ?? existing.format,
      pluginId: existing.pluginId,
      origin: 'user',
    });
    res.json({ config });
  }),
);

projectsRouter.delete(
  '/:id/configs/:configId',
  asyncHandler((req, res) => {
    deleteProjectConfig(req.params.id, req.params.configId);
    res.status(204).end();
  }),
);

projectsRouter.post(
  '/:id/configs/:configId/validate',
  asyncHandler((req, res) => {
    const input = parseWith(z.object({ content: z.string().max(2 * 1024 * 1024) }), req.body);
    const existing = getProjectConfig(req.params.id, req.params.configId);
    res.json(validateConfigContent(existing.format, input.content));
  }),
);

projectsRouter.post(
  '/:id/configs/validate',
  asyncHandler((req, res) => {
    const input = parseWith(z.object({ content: z.string().max(2 * 1024 * 1024), format: z.enum(['yaml', 'json', 'toml', 'text']) }), req.body);
    res.json(validateConfigContent(input.format, input.content));
  }),
);

projectsRouter.get(
  '/:id/configs/:configId/template',
  asyncHandler((req, res) => {
    const template = findConfigTemplateContent(req.params.id, req.params.configId);
    if (!template) throw notFound('No template file is associated with this configuration.');
    res.json(template);
  }),
);

projectsRouter.post(
  '/:id/configs/:configId/reset',
  asyncHandler((req, res) => {
    const template = findConfigTemplateContent(req.params.id, req.params.configId);
    if (!template) throw notFound('No template file is associated with this configuration.');
    res.json({ config: resetProjectConfig(req.params.id, req.params.configId, template.content, 'template') });
  }),
);

projectsRouter.get(
  '/:id/configs/:configId/download',
  asyncHandler((req, res) => {
    const config = getProjectConfig(req.params.id, req.params.configId);
    const fileName = config.path.split('/').pop() || 'config.txt';
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName.replace(/["\\]/g, '')}"`);
    res.send(config.content);
  }),
);

projectsRouter.post(
  '/:id/configs/import',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw badRequest('No file was uploaded.');
    const project = getProject(req.params.id);
    const rawName = pathBasename(req.file.originalname);
    const pluginId = typeof req.body.pluginId === 'string' && req.body.pluginId !== '' ? req.body.pluginId : null;
    const plugin = pluginId ? listProjectPlugins(project.id).find((p) => p.id === pluginId) : null;
    if (pluginId && !plugin) throw badRequest('Selected plugin is not part of this project.');
    const relative = typeof req.body.path === 'string' && req.body.path.trim() !== '' ? req.body.path.trim() : `${plugin?.configDir ?? 'imported'}/${rawName}`;
    const content = fs.readFileSync(req.file.path, 'utf8');
    fs.rmSync(req.file.path, { force: true });
    const configPath = normalizeConfigPath(relative);
    const format = formatForConfigPath(configPath);
    const validation = validateConfigContent(format, content);
    if (!validation.valid) throw badRequest('Imported file is not valid for its format.', validation.errors);
    const config = upsertProjectConfig(project.id, {
      path: configPath,
      content,
      format,
      pluginId,
      origin: 'imported',
    });
    res.status(201).json({ config, warnings: validation.warnings });
  }),
);

/* ----------------------------------- export ----------------------------------- */

function pathBasename(fileName: string): string {
  return fileName.split(/[\\/]/).pop() || 'config.txt';
}

projectsRouter.get(
  '/:id/export/preview',
  asyncHandler((req, res) => {
    const includeTemplateConfigs = req.query.includeTemplateConfigs !== 'false';
    res.json({ preview: buildExportPreview(req.params.id, { includeTemplateConfigs }) });
  }),
);

projectsRouter.get(
  '/:id/export',
  rateLimit('export', 30, 60_000),
  asyncHandler(async (req, res) => {
    const includeTemplateConfigs = req.query.includeTemplateConfigs !== 'false';
    const archive = await createExportArchive(req.params.id, { includeTemplateConfigs });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Length', String(archive.size));
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${archive.fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '')}"; filename*=UTF-8''${encodeURIComponent(archive.fileName)}`,
    );
    res.setHeader('Cache-Control', 'no-store');
    const stream = fs.createReadStream(archive.filePath);
    let cleaned = false;
    const cleanup = async () => {
      if (cleaned) return;
      cleaned = true;
      await archive.cleanup();
    };
    stream.on('error', async () => {
      await cleanup();
      if (!res.headersSent) res.status(500).json({ error: { code: 'export_failed', message: 'Export failed.' } });
      else res.end();
    });
    res.on('finish', cleanup);
    stream.pipe(res);
  }),
);
