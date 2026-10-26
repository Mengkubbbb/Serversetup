import { z } from 'zod';
import { aiCapability, config } from './config.js';
import { evaluateCompatibility } from './compat.js';
import { listLibrary } from './library.js';
import { getModrinthVersions, searchModrinth, selectPrimaryFile, type ModrinthSearchHit } from './modrinth.js';
import { getProjectRow } from './projects.js';
import { HttpError, badRequest } from './util.js';
import { isValidMinecraftVersion } from './mcmeta.js';
import type { AiPlan, AiPlanItem, CompatibilityResult, LibraryPlugin, ServerSoftware } from '../shared/types.js';

/* ------------------------------- provider layer ------------------------------- */

export interface AiProvider {
  name: string;
  model: string;
  completeJson(system: string, user: string): Promise<string>;
}

class OpenAiCompatibleProvider implements AiProvider {
  name: string;
  model: string;
  private baseUrl: string;
  private apiKey: string;

  constructor(options: { name: string; model: string; baseUrl: string; apiKey: string }) {
    this.name = options.name;
    this.model = options.model;
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
  }

  async completeJson(system: string, user: string): Promise<string> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0.2,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          ...(this.name === 'openai' ? { response_format: { type: 'json_object' } } : {}),
        }),
        signal: AbortSignal.timeout(60000),
      });
    } catch (err: any) {
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
        throw new HttpError(504, 'ai_timeout', 'The AI provider did not respond in time.');
      }
      throw new HttpError(502, 'ai_unreachable', `Could not reach the AI provider: ${err?.message ?? 'network error'}`);
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new HttpError(
        502,
        'ai_error',
        `AI provider returned HTTP ${response.status}. Check AI_API_KEY, AI_MODEL and AI_BASE_URL.`,
        detail ? detail.slice(0, 500) : undefined,
      );
    }
    const payload = (await response.json().catch(() => null)) as any;
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.trim() === '') {
      throw new HttpError(502, 'ai_bad_response', 'AI provider returned an empty response.');
    }
    return content;
  }
}

const PROVIDERS: Record<string, (options: { model: string; baseUrl: string; apiKey: string }) => AiProvider> = {
  openai: (o) => new OpenAiCompatibleProvider({ name: 'openai', ...o }),
  'openai-compatible': (o) => new OpenAiCompatibleProvider({ name: 'openai-compatible', ...o }),
};

export function getAiProvider(): AiProvider | null {
  const capability = aiCapability();
  if (!capability.configured) return null;
  const factory = PROVIDERS[config.ai.provider];
  if (!factory) return null;
  return factory({ model: config.ai.model, baseUrl: config.ai.baseUrl, apiKey: config.ai.apiKey });
}

/* ------------------------------- candidate set ------------------------------- */

interface Candidate {
  candidateId: string;
  name: string;
  description: string;
  source: 'local' | 'modrinth';
  modrinthProjectId: string | null;
  modrinthSlug: string | null;
  libraryPluginId: string | null;
  mcVersions: string[];
  loaders: string[];
  version: string | null;
  categories: string[];
  projectUrl: string | null;
  compatibility: CompatibilityResult;
}

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'create', 'for', 'from', 'i', 'in', 'is', 'it', 'make',
  'me', 'my', 'need', 'of', 'on', 'or', 'please', 'prioritize', 'server', 'setup', 'so', 'that', 'the', 'this',
  'to', 'use', 'want', 'with', 'without', 'would', 'lightweight', 'avoid', 'unnecessary', 'dependencies', 'free',
  'plugins', 'plugin', 'minecraft', 'version', 'using', 'support',
]);

const CATEGORY_QUERIES: { pattern: RegExp; query: string; label: string }[] = [
  { pattern: /permission|rank|group/i, query: 'permissions', label: 'Permissions' },
  { pattern: /economy|money|balance/i, query: 'economy', label: 'Economy' },
  { pattern: /home|sethome/i, query: 'homes', label: 'Homes' },
  { pattern: /protect|claim|grief/i, query: 'protection', label: 'Protection' },
  { pattern: /shop|store/i, query: 'shop', label: 'Shops' },
  { pattern: /auction/i, query: 'auction house', label: 'Auction House' },
  { pattern: /bedrock|geyser|floodgate/i, query: 'geyser bedrock', label: 'Bedrock Compatibility' },
  { pattern: /chat/i, query: 'chat', label: 'Chat' },
  { pattern: /scoreboard|tab ?list|tab\b/i, query: 'tablist scoreboard', label: 'Scoreboards' },
  { pattern: /teleport|tpa|warp/i, query: 'teleport', label: 'Teleportation' },
  { pattern: /auth|login|security/i, query: 'login auth', label: 'Authentication' },
  { pattern: /crate/i, query: 'crates', label: 'Crates' },
  { pattern: /npc/i, query: 'npc', label: 'NPCs' },
  { pattern: /quest|rpg/i, query: 'quests rpg', label: 'Other' },
  { pattern: /performance|lag|optimiz/i, query: 'performance', label: 'Performance' },
  { pattern: /anti.?cheat|cheat/i, query: 'anticheat', label: 'Administration' },
  { pattern: /world.?edit|build/i, query: 'worldedit', label: 'World Management' },
];

function detectRequested(prompt: string, projectSoftware: ServerSoftware, projectVersion: string) {
  const detected: { mcVersion?: string; software?: ServerSoftware } = {};
  const versionMatch = prompt.match(/\b(\d{1,2}\.\d{1,2}(?:\.\d{1,2})?|\d{2}w\d{2}[a-z])\b/i);
  if (versionMatch && isValidMinecraftVersion(versionMatch[1])) detected.mcVersion = versionMatch[1];
  const softwareMatch = prompt.match(/\b(paper|folia|leaf)\b/i);
  detected.software = softwareMatch ? (softwareMatch[1].toLowerCase() as ServerSoftware) : projectSoftware;
  const warnings: string[] = [];
  if (detected.mcVersion && detected.mcVersion !== projectVersion) {
    warnings.push(
      `The prompt mentions Minecraft ${detected.mcVersion}, but this project targets ${projectVersion}. Plugins are evaluated against the project's version. Change the project version first if needed.`,
    );
  }
  if (detected.software && detected.software !== projectSoftware) {
    warnings.push(
      `The prompt mentions ${detected.software}, but this project uses ${projectSoftware}. Compatibility is evaluated for ${projectSoftware}.`,
    );
  }
  return { detected, warnings };
}

function keywords(prompt: string): string[] {
  const words = prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w) && !/^(paper|folia|leaf|smp|minecraft)$/.test(w));
  return Array.from(new Set(words)).slice(0, 12);
}

async function collectCandidates(
  prompt: string,
  _projectId: string,
  projectSoftware: ServerSoftware,
  projectVersion: string,
  versionVerified: boolean,
): Promise<{ candidates: Candidate[]; warnings: string[] }> {
  const warnings: string[] = [];
  const candidates = new Map<string, Candidate>();
  const words = keywords(prompt);

  const localSearches = Array.from(new Set([...words.slice(0, 6), prompt.slice(0, 60)]));
  for (const term of localSearches) {
    const { items } = listLibrary({ q: term, limit: 8 });
    for (const plugin of items) addLocalCandidate(candidates, plugin, projectSoftware, projectVersion, versionVerified);
  }

  if (candidates.size < 4) {
    const { items } = listLibrary({ limit: 20, sort: 'recent' });
    for (const plugin of items) addLocalCandidate(candidates, plugin, projectSoftware, projectVersion, versionVerified);
  }

  const matchedCategories = CATEGORY_QUERIES.filter((c) => c.pattern.test(prompt));
  const queries = Array.from(
    new Set([
      ...matchedCategories.map((c) => c.query),
      ...matchedCategories.map((c) => c.label.toLowerCase()),
      ...words.slice(0, 3),
    ]),
  ).slice(0, 4);

  const searchErrors: string[] = [];
  for (const query of queries) {
    try {
      const response = await searchModrinth({ query, limit: 6, mcVersion: versionVerified ? projectVersion : undefined });
      const hits = response.hits.filter((hit) => hit.project_id !== '');
      for (const hit of hits) addModrinthCandidate(candidates, hit, projectSoftware, projectVersion, versionVerified);
      if (hits.length === 0 && versionVerified) {
        const fallback = await searchModrinth({ query, limit: 4 });
        for (const hit of fallback.hits) addModrinthCandidate(candidates, hit, projectSoftware, projectVersion, versionVerified);
      }
    } catch (err: any) {
      searchErrors.push(`${query}: ${err?.message ?? err}`);
    }
  }
  if (searchErrors.length > 0) {
    warnings.push(`Some Modrinth searches failed: ${searchErrors.join('; ')}`);
  }
  if (candidates.size === 0) {
    warnings.push('No candidate plugins were found locally or on Modrinth for this request.');
  }
  return { candidates: Array.from(candidates.values()), warnings: [...warnings, ...detectRequested(prompt, projectSoftware, projectVersion).warnings] };
}

function addLocalCandidate(
  map: Map<string, Candidate>,
  plugin: LibraryPlugin,
  software: ServerSoftware,
  version: string,
  versionVerified: boolean,
) {
  const id = `local:${plugin.id}`;
  if (map.has(id)) return;
  const compatibility = evaluateCompatibility(
    { mcVersions: plugin.mcVersions, loaders: plugin.loaders, foliaCompatible: plugin.foliaCompatible },
    version,
    software,
    { versionVerified },
  );
  map.set(id, {
    candidateId: id,
    name: plugin.name,
    description: plugin.description,
    source: 'local',
    modrinthProjectId: plugin.sourceProjectId,
    modrinthSlug: plugin.slug,
    libraryPluginId: plugin.id,
    mcVersions: plugin.mcVersions,
    loaders: plugin.loaders,
    version: plugin.version,
    categories: plugin.categories,
    projectUrl: plugin.projectUrl,
    compatibility,
  });
}

function addModrinthCandidate(
  map: Map<string, Candidate>,
  hit: ModrinthSearchHit,
  software: ServerSoftware,
  version: string,
  versionVerified: boolean,
) {
  const id = `modrinth:${hit.project_id}`;
  if (map.has(id)) return;
  const loaders = hit.categories.filter((c) => ['paper', 'spigot', 'bukkit', 'folia', 'fabric', 'forge', 'neoforge', 'quilt', 'velocity', 'bungeecord', 'waterfall', 'purpur'].includes(c));
  const compatibility = evaluateCompatibility(
    { mcVersions: hit.versions ?? [], loaders },
    version,
    software,
    { versionVerified },
  );
  map.set(id, {
    candidateId: id,
    name: hit.title,
    description: hit.description,
    source: 'modrinth',
    modrinthProjectId: hit.project_id,
    modrinthSlug: hit.slug,
    libraryPluginId: null,
    mcVersions: hit.versions ?? [],
    loaders,
    version: null,
    categories: hit.display_categories ?? hit.categories,
    projectUrl: `https://modrinth.com/plugin/${hit.slug}`,
    compatibility,
  });
}

/* --------------------------------- the planner -------------------------------- */

const aiResponseSchema = z.object({
  summary: z.string().max(3000),
  selections: z
    .array(
      z.object({
        candidateId: z.string().max(120),
        reason: z.string().max(800),
        category: z.string().max(80).optional().default('Other'),
      }),
    )
    .max(25),
  unresolved: z.array(z.string().max(400)).max(15).optional().default([]),
  duplicatesAvoided: z.array(z.string().max(400)).max(15).optional().default([]),
  warnings: z.array(z.string().max(800)).max(15).optional().default([]),
});

const SYSTEM_PROMPT = `You are a Minecraft server plugin planning assistant for a self-hosted setup builder.
You MUST build a plugin installation plan using ONLY the candidates provided by the application.
Rules:
- Only reference candidateId values exactly as given. Never invent plugin ids, versions, URLs, dependencies, or compatibility claims.
- Respect the compatibility data attached to each candidate. Prefer verified candidates. You may include a potentially compatible candidate but must mention the risk in its reason. Never include an incompatible candidate.
- Avoid duplicate functionality (for example two economy providers or two permission plugins). If you omit a redundant candidate, list it in duplicatesAvoided.
- If a requested capability has no suitable candidate, put the requirement in unresolved instead of inventing a plugin.
- The plan is text; it will only be installed after explicit user approval. Never claim anything was installed.
- Answer with a single JSON object:
{
  "summary": "short explanation of the plan",
  "selections": [{"candidateId": "...", "reason": "...", "category": "..."}],
  "unresolved": ["..."],
  "duplicatesAvoided": ["..."],
  "warnings": ["..."]
}`;

function parseJsonLoose(content: string): unknown {
  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : trimmed;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1) throw new HttpError(502, 'ai_bad_response', 'AI response was not valid JSON.');
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    throw new HttpError(502, 'ai_bad_response', 'AI response was not valid JSON.');
  }
}

async function resolvePlanVersion(
  candidate: Candidate,
  projectVersion: string,
  projectSoftware: ServerSoftware,
): Promise<{ versionId: string | null; versionNumber: string | null; fileAvailable: boolean; warning?: string }> {
  if (candidate.source === 'local') {
    return {
      versionId: null,
      versionNumber: candidate.version,
      fileAvailable: true,
      warning: undefined,
    };
  }
  if (!candidate.modrinthProjectId) return { versionId: null, versionNumber: null, fileAvailable: false };
  const attempts = [
    { loaders: projectSoftware === 'folia' ? ['folia'] : ['paper', 'spigot', 'bukkit'], mcVersion: projectVersion },
    { loaders: undefined, mcVersion: projectVersion },
    { loaders: undefined, mcVersion: undefined },
  ];
  for (const attempt of attempts) {
    try {
      const versions = await getModrinthVersions(candidate.modrinthProjectId, attempt);
      const usable = versions.find((v) => selectPrimaryFile(v) !== null);
      if (usable) {
        return {
          versionId: usable.id,
          versionNumber: usable.version_number,
          fileAvailable: true,
          warning: attempt.mcVersion ? undefined : `No version explicitly lists Minecraft ${projectVersion}; review before installing.`,
        };
      }
    } catch {
      /* try next attempt */
    }
  }
  return {
    versionId: null,
    versionNumber: null,
    fileAvailable: false,
    warning: 'No downloadable file was found for this plugin with the current filters.',
  };
}

export async function buildAiPlan(projectId: string, prompt: string): Promise<AiPlan> {
  const provider = getAiProvider();
  const capability = aiCapability();
  if (!provider) {
    throw new HttpError(503, 'ai_not_configured', capability.reason ?? 'AI is not configured.', {
      provider: capability.provider,
      hint: 'Set AI_PROVIDER, AI_API_KEY and AI_MODEL in .env, then restart the server.',
    });
  }
  if (!prompt || prompt.trim().length < 8) throw badRequest('Describe what you need (at least a few words).');
  if (prompt.length > 4000) throw badRequest('Prompt is too long (4000 character limit).');

  const project = getProjectRow(projectId);
  const { candidates, warnings: collectionWarnings } = await collectCandidates(
    prompt,
    projectId,
    project.software,
    project.mc_version,
    Boolean(project.version_verified),
  );

  const candidatePayload = candidates.map((c) => ({
    candidateId: c.candidateId,
    name: c.name,
    description: c.description.slice(0, 300),
    source: c.source,
    categories: c.categories.slice(0, 6),
    version: c.version,
    minecraftVersions: c.mcVersions.slice(0, 30),
    loaders: c.loaders,
    compatibility: c.compatibility.level,
    compatibilityNotes: c.compatibility.reasons,
    projectUrl: c.projectUrl,
  }));

  const userMessage = `PROJECT
Name: ${project.name}
Minecraft version: ${project.mc_version} (verified: ${Boolean(project.version_verified)})
Server software: ${project.software}

USER REQUEST
${prompt}

CANDIDATES (the only plugins you may reference)
${JSON.stringify(candidatePayload, null, 2)}`;

  let raw: string;
  try {
    raw = await provider.completeJson(SYSTEM_PROMPT, userMessage);
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(502, 'ai_error', 'AI planning failed.');
  }

  const parsed = aiResponseSchema.safeParse(parseJsonLoose(raw));
  if (!parsed.success) {
    throw new HttpError(502, 'ai_invalid_plan', 'AI response did not match the expected plan schema.', parsed.error.issues.map((i) => i.message));
  }

  const warnings = [...collectionWarnings, ...parsed.data.warnings];
  const byId = new Map(candidates.map((c) => [c.candidateId, c]));
  const items: AiPlanItem[] = [];
  const seen = new Set<string>();

  for (const selection of parsed.data.selections) {
    const candidate = byId.get(selection.candidateId);
    if (!candidate) {
      warnings.push(`Dropped a recommendation for an unknown candidate id (${selection.candidateId.slice(0, 40)}).`);
      continue;
    }
    if (seen.has(candidate.candidateId)) continue;
    seen.add(candidate.candidateId);
    if (candidate.compatibility.level === 'incompatible') {
      warnings.push(`Skipped ${candidate.name}: it is incompatible with ${project.software} ${project.mc_version}.`);
      continue;
    }
    const resolved = await resolvePlanVersion(candidate, project.mc_version, project.software);
    const itemWarnings = [...candidate.compatibility.reasons.filter((r) => candidate.compatibility.level !== 'verified')];
    if (resolved.warning) itemWarnings.push(resolved.warning);
    items.push({
      candidateId: candidate.candidateId,
      libraryPluginId: candidate.libraryPluginId,
      name: candidate.name,
      source: candidate.source,
      reason: selection.reason,
      category: selection.category || candidate.categories[0] || 'Other',
      compatibility: candidate.compatibility,
      versionId: resolved.versionId,
      fileAvailable: resolved.fileAvailable,
      warnings: Array.from(new Set(itemWarnings)),
    });
  }

  return {
    prompt,
    summary: parsed.data.summary,
    detected: detectRequested(prompt, project.software, project.mc_version).detected,
    items,
    unresolved: parsed.data.unresolved,
    warnings: Array.from(new Set(warnings)),
    duplicatesAvoided: parsed.data.duplicatesAvoided,
    provider: { provider: provider.name, model: provider.model },
    candidateCount: candidates.length,
    createdAt: new Date().toISOString(),
  };
}

export const aiInternals = { keywords, detectRequested };
