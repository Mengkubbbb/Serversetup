import fs from 'node:fs';
import { Router } from 'express';
import { z } from 'zod';
import { upload } from '../upload.js';
import { asyncHandler, badRequest, conflict, notFound, parseWith, rateLimit } from '../util.js';
import {
  addCategory,
  deleteCategory,
  deleteLibraryPlugin,
  getLibraryPlugin,
  importJarUpload,
  importTemplateUpload,
  listCategories,
  listLibrary,
  listTemplateFiles,
  readTemplateFile,
  updateLibraryPlugin,
} from '../library.js';
import { installModrinthPlugin } from '../installer.js';
import { config } from '../config.js';

export const libraryRouter = Router();

function toList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value !== 'string' || value.trim() === '') return [];
  const trimmed = value.trim();
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
    } catch {
      /* fall through to comma split */
    }
  }
  return trimmed.split(',').map((s) => s.trim()).filter(Boolean);
}

libraryRouter.get(
  '/library',
  asyncHandler((req, res) => {
    const query = {
      q: typeof req.query.q === 'string' ? req.query.q : undefined,
      category: typeof req.query.category === 'string' && req.query.category !== 'all' ? req.query.category : undefined,
      source: (typeof req.query.source === 'string' ? req.query.source : 'all') as 'all' | 'modrinth' | 'local',
      mcVersion: typeof req.query.mcVersion === 'string' ? req.query.mcVersion : undefined,
      software: typeof req.query.software === 'string' ? req.query.software : undefined,
      hasFileOnly: req.query.hasFile === 'true',
      limit: req.query.limit ? Number(req.query.limit) : 100,
      offset: req.query.offset ? Number(req.query.offset) : 0,
      sort: req.query.sort === 'name' ? ('name' as const) : ('recent' as const),
    };
    const result = listLibrary(query);
    res.json({ ...result, categories: listCategories() });
  }),
);

libraryRouter.get(
  '/library/:id',
  asyncHandler((req, res) => {
    const plugin = getLibraryPlugin(req.params.id);
    if (!plugin) throw notFound('Plugin not found.');
    res.json({ plugin });
  }),
);

libraryRouter.post(
  '/library/upload',
  rateLimit('upload', 20, 60_000),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw badRequest('No file was uploaded.');
    const kind = String(req.body.kind ?? (req.file.originalname.toLowerCase().endsWith('.jar') ? 'jar' : 'template'));
    const common = {
      tempPath: req.file.path,
      originalName: req.file.originalname,
      name: req.body.name,
      version: req.body.version,
      description: req.body.description,
      author: req.body.author,
      categories: toList(req.body.categories),
      mcVersions: toList(req.body.mcVersions),
      loaders: toList(req.body.loaders).map((l) => l.toLowerCase()),
      notes: req.body.notes,
      projectUrl: req.body.projectUrl,
      configDir: req.body.configDir,
      linkToPluginId: typeof req.body.linkToPluginId === 'string' && req.body.linkToPluginId !== '' ? req.body.linkToPluginId : undefined,
    };
    try {
      if (kind === 'template') {
        const result = await importTemplateUpload(common);
        res.status(201).json({ plugin: result.plugin, files: result.files, skipped: result.skipped, kind: 'template' });
      } else {
        const result = await importJarUpload(common);
        res.status(201).json({ plugin: result.plugin, inspection: result.inspection, kind: 'jar' });
      }
    } catch (err) {
      fs.rmSync(req.file.path, { force: true });
      throw err;
    }
  }),
);

libraryRouter.patch(
  '/library/:id',
  asyncHandler((req, res) => {
    const input = parseWith(
      z.object({
        name: z.string().trim().min(1).max(120).optional(),
        description: z.string().max(4000).optional(),
        author: z.string().max(200).optional(),
        version: z.string().max(80).optional(),
        categories: z.array(z.string().max(60)).max(20).optional(),
        mcVersions: z.array(z.string().max(40)).max(100).optional(),
        loaders: z.array(z.string().max(40)).max(20).optional(),
        notes: z.string().max(4000).optional(),
        projectUrl: z.string().max(500).optional(),
        iconUrl: z.string().max(500).optional(),
      }),
      req.body,
    );
    res.json({ plugin: updateLibraryPlugin(req.params.id, input) });
  }),
);

libraryRouter.delete(
  '/library/:id',
  asyncHandler((req, res) => {
    deleteLibraryPlugin(req.params.id, { force: req.query.force === 'true' });
    res.status(204).end();
  }),
);

libraryRouter.get(
  '/library/:id/template-files',
  asyncHandler((req, res) => {
    const plugin = getLibraryPlugin(req.params.id);
    if (!plugin) throw notFound('Plugin not found.');
    const files = listTemplateFiles(plugin);
    res.json({ files, configDir: plugin.configTemplateDir });
  }),
);

libraryRouter.get(
  '/library/:id/template-file',
  asyncHandler((req, res) => {
    const plugin = getLibraryPlugin(req.params.id);
    if (!plugin) throw notFound('Plugin not found.');
    const relative = typeof req.query.path === 'string' ? req.query.path : '';
    if (!relative) throw badRequest('A template file path is required.');
    res.json(readTemplateFile(plugin, relative));
  }),
);

libraryRouter.get(
  '/categories',
  asyncHandler((_req, res) => {
    res.json({ categories: listCategories() });
  }),
);

libraryRouter.post(
  '/categories',
  asyncHandler((req, res) => {
    const { name } = parseWith(z.object({ name: z.string().trim().min(1).max(60) }), req.body);
    addCategory(name);
    res.status(201).json({ categories: listCategories() });
  }),
);

libraryRouter.delete(
  '/categories/:name',
  asyncHandler((req, res) => {
    deleteCategory(req.params.name);
    res.json({ categories: listCategories() });
  }),
);

const downloadSchema = z
  .object({
    modrinthProjectId: z.string().trim().min(1).max(64),
    modrinthVersionId: z.string().trim().max(64).optional(),
  })
  .strict();

/** Explicit download into the shared library cache (never into a project). */
libraryRouter.post(
  '/download',
  rateLimit('download', 12, 60_000),
  asyncHandler(async (req, res) => {
    const input = parseWith(downloadSchema, req.body);
    const result = await installModrinthPlugin({
      projectIdOrSlug: input.modrinthProjectId,
      versionId: input.modrinthVersionId,
      mcVersion: typeof req.body.mcVersion === 'string' ? req.body.mcVersion : undefined,
      software: typeof req.body.software === 'string' ? req.body.software : undefined,
    });
    res.status(201).json({ plugin: result.plugin, cached: result.cached, warnings: result.warnings });
  }),
);

libraryRouter.post(
  '/library/:id/redownload',
  rateLimit('download', 12, 60_000),
  asyncHandler(async (req, res) => {
    const plugin = getLibraryPlugin(req.params.id);
    if (!plugin) throw notFound('Plugin not found.');
    if (plugin.source !== 'modrinth' || !plugin.sourceProjectId || !plugin.sourceVersionId) {
      throw conflict('Only Modrinth library entries can be re-downloaded.');
    }
    const result = await installModrinthPlugin({
      projectIdOrSlug: plugin.sourceProjectId,
      versionId: plugin.sourceVersionId,
    });
    res.json({ plugin: result.plugin, cached: result.cached });
  }),
);

libraryRouter.get(
  '/limits',
  asyncHandler((_req, res) => {
    res.json({
      maxUploadBytes: config.maxUploadBytes,
      maxArchiveEntries: config.maxArchiveEntries,
      maxExtractedBytes: config.maxExtractedBytes,
      maxDownloadBytes: config.maxDownloadBytes,
    });
  }),
);
