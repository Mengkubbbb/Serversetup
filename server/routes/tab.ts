import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, badRequest, parseWith } from '../util.js';
import { buildTabPreview, defaultTabModel, generateTabYaml, parseTabYaml, tabAdapterForVersion, tabModelSchema, validateTabModel } from '../tab.js';
import { getProject, listProjectPlugins, upsertProjectConfig, listProjectConfigs } from '../projects.js';
import { LUCKPERMS_GUIDE } from '../luckperms.js';
import { parseYamlSafe } from '../yaml.js';

export const tabRouter = Router();

const extraSectionsSchema = z.record(z.unknown()).optional().default({});

tabRouter.get(
  '/model',
  asyncHandler((_req, res) => {
    res.json({ model: defaultTabModel, adapter: 5 });
  }),
);

tabRouter.post(
  '/parse',
  asyncHandler((req, res) => {
    const input = parseWith(z.object({ content: z.string().min(1).max(2 * 1024 * 1024) }), req.body);
    try {
      const parsed = parseTabYaml(input.content);
      res.json(parsed);
    } catch (err: any) {
      throw badRequest(`TAB configuration could not be parsed: ${err?.message ?? err}`);
    }
  }),
);

tabRouter.post(
  '/validate',
  asyncHandler((req, res) => {
    const input = parseWith(z.object({ model: tabModelSchema, extraSections: extraSectionsSchema }), req.body);
    const warnings = validateTabModel(input.model);
    const generated = generateTabYaml(input.model, input.extraSections as Record<string, unknown>);
    let yamlValid = true;
    let error: string | null = null;
    try {
      parseYamlSafe(generated.content);
    } catch (err: any) {
      yamlValid = false;
      error = err?.message ?? 'Invalid YAML';
    }
    res.json({ valid: yamlValid, error, warnings: Array.from(new Set([...warnings, ...generated.warnings])) });
  }),
);

tabRouter.post(
  '/preview',
  asyncHandler((req, res) => {
    const input = parseWith(z.object({ model: tabModelSchema }), req.body);
    res.json({ preview: buildTabPreview(input.model), warnings: validateTabModel(input.model) });
  }),
);

tabRouter.post(
  '/generate',
  asyncHandler((req, res) => {
    const input = parseWith(z.object({ model: tabModelSchema, extraSections: extraSectionsSchema }), req.body);
    const generated = generateTabYaml(input.model, input.extraSections as Record<string, unknown>);
    res.json(generated);
  }),
);

tabRouter.get(
  '/projects/:id/context',
  asyncHandler((req, res) => {
    const project = getProject(req.params.id);
    const plugins = listProjectPlugins(req.params.id);
    const tabPlugin = plugins.find((p) => /^tab$/i.test(p.displayName) || p.configDir === 'TAB');
    const adapter = tabAdapterForVersion(tabPlugin?.version ?? null);
    const existing = listProjectConfigs(req.params.id).find((c) => c.path === 'TAB/config.yml');
    res.json({
      projectId: project.id,
      tabInstalled: Boolean(tabPlugin),
      tabVersion: tabPlugin?.version ?? null,
      adapter,
      existingConfig: existing
        ? { id: existing.id, content: existing.content, updatedAt: existing.updatedAt }
        : null,
    });
  }),
);

tabRouter.post(
  '/projects/:id/save',
  asyncHandler((req, res) => {
    const input = parseWith(
      z.object({
        content: z.string().min(1).max(2 * 1024 * 1024),
        path: z.string().max(120).optional().default('TAB/config.yml'),
      }),
      req.body,
    );
    getProject(req.params.id);
    try {
      parseYamlSafe(input.content);
    } catch (err: any) {
      throw badRequest(`Generated TAB configuration is not valid YAML: ${err?.message ?? err}`);
    }
    const plugins = listProjectPlugins(req.params.id);
    const tabPlugin = plugins.find((p) => /^tab$/i.test(p.displayName) || p.configDir === 'TAB');
    const config = upsertProjectConfig(req.params.id, {
      path: input.path,
      content: input.content,
      format: 'yaml',
      pluginId: tabPlugin?.id ?? null,
      origin: 'generated',
    });
    res.status(201).json({ config });
  }),
);

tabRouter.get(
  '/luckperms/guide',
  asyncHandler(async (_req, res) => {
    res.json({ guide: LUCKPERMS_GUIDE });
  }),
);
