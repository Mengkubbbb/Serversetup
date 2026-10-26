import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, parseWith, rateLimit } from '../util.js';
import { buildAiPlan } from '../ai.js';
import { aiCapability } from '../config.js';
import { evaluateCompatibility } from '../compat.js';
import { addPluginToProject, getProjectRow, listProjectPlugins, projectSummary, removePluginFromProject, touchProject } from '../projects.js';
import { getLibraryPlugin } from '../library.js';

export const aiRouter = Router();

aiRouter.get(
  '/status',
  asyncHandler((_req, res) => {
    const capability = aiCapability();
    res.json({
      ...capability,
      note: capability.configured
        ? 'AI planning is available. Plans always require manual approval before installation.'
        : 'AI recommendations are unavailable until an AI provider is configured. Manual plugin selection, templates, editing and export work without AI.',
      configuration: {
        envVars: ['AI_PROVIDER', 'AI_API_KEY', 'AI_MODEL', 'AI_BASE_URL'],
        providers: ['openai', 'openai-compatible'],
      },
    });
  }),
);

aiRouter.post(
  '/plan',
  rateLimit('ai-plan', 8, 60_000),
  asyncHandler(async (req, res) => {
    const input = parseWith(
      z.object({
        projectId: z.string().uuid(),
        prompt: z.string().trim().min(8).max(4000),
      }),
      req.body,
    );
    getProjectRow(input.projectId);
    const plan = await buildAiPlan(input.projectId, input.prompt);
    res.json({ plan });
  }),
);

const installSchema = z.object({
  projectId: z.string().uuid(),
  allowIncompatible: z.boolean().optional().default(false),
  items: z
    .array(
      z.object({
        libraryPluginId: z.string().uuid().nullable().optional(),
        modrinthProjectId: z.string().max(64).nullable().optional(),
        modrinthVersionId: z.string().max(64).nullable().optional(),
        name: z.string().max(120).optional(),
      }),
    )
    .min(1)
    .max(25),
});

/** Installs an approved plan through the normal plugin installation workflow. */
aiRouter.post(
  '/install-plan',
  rateLimit('ai-install', 12, 60_000),
  asyncHandler(async (req, res) => {
    const input = parseWith(installSchema, req.body);
    const project = getProjectRow(input.projectId);
    const results: any[] = [];

    for (const item of input.items) {
      const label = item.name ?? item.modrinthProjectId ?? 'plugin';
      try {
        if (!item.libraryPluginId && !item.modrinthProjectId) {
          results.push({ name: label, status: 'failed', error: 'Plan item has no resolvable plugin reference.' });
          continue;
        }
        // Re-validate compatibility from source metadata instead of trusting AI output.
        if (item.libraryPluginId) {
          const library = getLibraryPlugin(item.libraryPluginId);
          if (!library) {
            results.push({ name: label, status: 'failed', error: 'Library plugin no longer exists.' });
            continue;
          }
          const compat = evaluateCompatibility(
            { mcVersions: library.mcVersions, loaders: library.loaders, foliaCompatible: library.foliaCompatible },
            project.mc_version,
            project.software,
            { versionVerified: Boolean(project.version_verified) },
          );
          if (compat.level === 'incompatible' && !input.allowIncompatible) {
            results.push({ name: library.name, status: 'rejected', error: `Incompatible: ${compat.reasons.join(' ')}` });
            continue;
          }
        }
        const result = await addPluginToProject(input.projectId, {
          libraryPluginId: item.libraryPluginId ?? undefined,
          modrinthProjectId: item.modrinthProjectId ?? undefined,
          modrinthVersionId: item.modrinthVersionId ?? undefined,
        });
        if (result.plugin.compatibility.level === 'incompatible' && !input.allowIncompatible) {
          removePluginFromProject(input.projectId, result.plugin.id, { deleteConfigs: true });
          results.push({
            name: result.plugin.displayName,
            status: 'rejected',
            error: `Incompatible with ${project.software} ${project.mc_version}: ${result.plugin.compatibility.reasons.join(' ')}`,
          });
          continue;
        }
        results.push({ name: result.plugin.displayName, status: 'installed', plugin: result.plugin, warnings: result.warnings });
      } catch (err: any) {
        results.push({ name: label, status: 'failed', error: err?.message ?? 'Install failed' });
      }
    }

    touchProject(input.projectId);
    res.json({
      results,
      plugins: listProjectPlugins(input.projectId),
      summary: projectSummary(input.projectId),
    });
  }),
);
