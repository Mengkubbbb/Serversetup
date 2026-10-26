import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, parseWith } from '../util.js';
import { getModrinthProject, getModrinthVersions, mapSearchHit, searchModrinth } from '../modrinth.js';

export const modrinthRouter = Router();

modrinthRouter.get(
  '/search',
  asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 12, 30);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const categories = typeof req.query.categories === 'string' && req.query.categories !== ''
      ? req.query.categories.split(',').map((c) => c.trim()).filter(Boolean)
      : undefined;
    const response = await searchModrinth({
      query: typeof req.query.q === 'string' ? req.query.q : '',
      limit,
      offset,
      mcVersion: typeof req.query.mcVersion === 'string' && req.query.mcVersion !== '' ? req.query.mcVersion : undefined,
      categories,
      loaders: undefined,
    });
    res.json({
      hits: response.hits.map(mapSearchHit),
      totalHits: response.total_hits,
      offset: response.offset,
      limit: response.limit,
    });
  }),
);

modrinthRouter.get(
  '/project/:id',
  asyncHandler(async (req, res) => {
    const project = await getModrinthProject(req.params.id);
    res.json({
      project: {
        id: project.id,
        slug: project.slug,
        title: project.title,
        description: project.description,
        body: project.body ?? '',
        categories: project.categories,
        gameVersions: project.game_versions,
        loaders: project.loaders,
        iconUrl: project.icon_url,
        downloads: project.downloads,
        sourceUrl: project.source_url ?? null,
        license: project.license ?? null,
        url: `https://modrinth.com/plugin/${project.slug}`,
      },
    });
  }),
);

modrinthRouter.get(
  '/versions/:id',
  asyncHandler(async (req, res) => {
    const loaders = typeof req.query.loaders === 'string' && req.query.loaders !== ''
      ? req.query.loaders.split(',').map((l) => l.trim()).filter(Boolean)
      : undefined;
    const mcVersion = typeof req.query.mcVersion === 'string' && req.query.mcVersion !== '' ? req.query.mcVersion : undefined;
    const versions = await getModrinthVersions(req.params.id, { loaders, mcVersion });
    res.json({
      versions: versions.map((version) => ({
        id: version.id,
        name: version.name,
        versionNumber: version.version_number,
        versionType: version.version_type,
        gameVersions: version.game_versions,
        loaders: version.loaders,
        publishedAt: version.date_published,
        downloads: version.files.filter((f) => f.primary).reduce((sum, f) => sum + f.size, 0),
        files: version.files.map((file) => ({
          filename: file.filename,
          size: file.size,
          hashes: Object.keys(file.hashes),
          primary: file.primary,
        })),
        dependencies: version.dependencies.map((dep) => ({
          projectId: dep.project_id,
          versionId: dep.version_id,
          kind: dep.dependency_type,
        })),
      })),
    });
  }),
);

const resolveSchema = z.object({
  projectId: z.string().min(1).max(64),
  versionId: z.string().max(64).optional(),
});

modrinthRouter.post(
  '/resolve',
  asyncHandler(async (req, res) => {
    const input = parseWith(resolveSchema, req.body);
    const versions = await getModrinthVersions(input.projectId);
    const selected = input.versionId
      ? versions.find((v) => v.id === input.versionId)
      : versions.find((v) => v.files.some((f) => f.primary));
    if (!selected) {
      res.status(404).json({ error: { code: 'not_found', message: 'No matching version found.' } });
      return;
    }
    res.json({ versionId: selected.id, versionNumber: selected.version_number, gameVersions: selected.game_versions });
  }),
);
