import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, parseWith, rateLimit } from '../util.js';
import {
  applyTemplateToProject,
  createTemplate,
  deleteTemplate,
  duplicateTemplate,
  getTemplate,
  listTemplates,
  previewTemplate,
  templateFromProject,
  updateTemplate,
} from '../templates.js';
import { getProjectRow } from '../projects.js';

export const templatesRouter = Router();

const softwareSchema = z.enum(['paper', 'folia', 'leaf']);

const refSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().max(80).optional(),
  modrinthSlug: z.string().trim().max(80).optional(),
  versionConstraint: z.string().max(80).optional(),
  required: z.boolean().default(true),
  category: z.string().max(60).optional(),
  note: z.string().max(500).optional(),
});

const templateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(4000).optional().default(''),
  categories: z.array(z.string().max(60)).max(20).optional().default([]),
  mcVersions: z.array(z.string().max(40)).max(60).optional().default([]),
  software: softwareSchema.nullable().optional(),
  plugins: z.array(refSchema).max(60).optional().default([]),
  warnings: z.array(z.string().max(500)).max(30).optional().default([]),
  notes: z.string().max(4000).optional().default(''),
});

templatesRouter.get(
  '/',
  asyncHandler((_req, res) => {
    res.json({ templates: listTemplates() });
  }),
);

templatesRouter.post(
  '/',
  asyncHandler((req, res) => {
    const input = parseWith(templateSchema, req.body);
    res.status(201).json({ template: createTemplate(input) });
  }),
);

templatesRouter.post(
  '/from-project',
  asyncHandler((req, res) => {
    const input = parseWith(z.object({ projectId: z.string().uuid(), name: z.string().trim().min(1).max(120), description: z.string().max(1000).optional() }), req.body);
    getProjectRow(input.projectId);
    res.status(201).json({ template: templateFromProject(input.projectId, input) });
  }),
);

templatesRouter.get(
  '/:id',
  asyncHandler((req, res) => {
    res.json({ template: getTemplate(req.params.id) });
  }),
);

templatesRouter.patch(
  '/:id',
  asyncHandler((req, res) => {
    const input = parseWith(templateSchema.partial(), req.body);
    res.json({ template: updateTemplate(req.params.id, input) });
  }),
);

templatesRouter.delete(
  '/:id',
  asyncHandler((req, res) => {
    deleteTemplate(req.params.id);
    res.status(204).end();
  }),
);

templatesRouter.post(
  '/:id/duplicate',
  asyncHandler((req, res) => {
    const input = parseWith(z.object({ name: z.string().trim().max(120).optional() }), req.body ?? {});
    res.status(201).json({ template: duplicateTemplate(req.params.id, input.name) });
  }),
);

templatesRouter.get(
  '/:id/preview',
  asyncHandler((req, res) => {
    const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
    if (projectId) getProjectRow(projectId);
    res.json({ preview: previewTemplate(req.params.id, projectId) });
  }),
);

templatesRouter.post(
  '/:id/apply',
  rateLimit('template-apply', 20, 60_000),
  asyncHandler(async (req, res) => {
    const input = parseWith(
      z.object({
        projectId: z.string().uuid(),
        installMissing: z.boolean().optional().default(false),
        overwriteConfigs: z.boolean().optional().default(false),
      }),
      req.body,
    );
    getProjectRow(input.projectId);
    const result = await applyTemplateToProject(req.params.id, input);
    res.json(result);
  }),
);
