import { compareVersions } from './mcmeta.js';
import type { CompatibilityLevel, CompatibilityResult, ServerSoftware } from '../shared/types.js';

interface CompatInput {
  mcVersions: string[];
  loaders: string[];
  foliaCompatible?: boolean | null;
  minMcVersion?: string | null;
}

const SEVERITY: Record<CompatibilityLevel, number> = {
  verified: 0,
  potential: 1,
  unknown: 2,
  incompatible: 3,
};

const FOLIA_WARNING =
  'Folia splits the world into regions and runs them in parallel. A plugin must be explicitly built for Folia; Paper support alone does not imply Folia support.';
const LEAF_WARNING =
  'Leaf is a Paper fork. Most Paper plugins work, but each plugin should be verified against Leaf before production use.';

interface LoaderEvaluation {
  level: CompatibilityLevel;
  reasons: string[];
}

function evaluateLoaders(plugin: CompatInput, software: ServerSoftware): LoaderEvaluation {
  const loaders = (plugin.loaders ?? []).map((l) => l.toLowerCase());
  if (software === 'folia' && plugin.foliaCompatible === true) {
    return { level: 'verified', reasons: ['Plugin metadata explicitly declares Folia support.'] };
  }
  if (loaders.length === 0) {
    return { level: 'unknown', reasons: ['Plugin does not publish loader metadata; compatibility cannot be verified.'] };
  }

  if (software === 'paper') {
    if (loaders.some((l) => ['paper', 'spigot', 'bukkit'].includes(l))) {
      return {
        level: 'verified',
        reasons: ['Plugin declares Paper/Spigot/Bukkit support; Paper loads Bukkit-compatible plugins.'],
      };
    }
    if (loaders.includes('folia')) {
      return {
        level: 'incompatible',
        reasons: ['Plugin is built for Folia and depends on the Folia API, which Paper does not provide.'],
      };
    }
    if (loaders.some((l) => ['fabric', 'forge', 'neoforge', 'quilt'].includes(l))) {
      return { level: 'incompatible', reasons: ['Plugin targets a mod loader, not a Paper server.'] };
    }
    return { level: 'potential', reasons: ['Plugin declares non-Paper loaders; compatibility is unconfirmed.'] };
  }

  if (software === 'folia') {
    if (loaders.includes('folia')) {
      return { level: 'verified', reasons: ['Plugin declares Folia support in its metadata.'] };
    }
    if (loaders.some((l) => ['paper', 'spigot', 'bukkit'].includes(l))) {
      return { level: 'potential', reasons: [FOLIA_WARNING] };
    }
    return {
      level: 'incompatible',
      reasons: ['Plugin does not declare Paper or Folia support.', FOLIA_WARNING],
    };
  }

  // Leaf
  if (loaders.includes('leaf')) {
    return { level: 'verified', reasons: ['Plugin declares Leaf support in its metadata.'] };
  }
  if (loaders.some((l) => ['paper', 'spigot', 'bukkit'].includes(l))) {
    return { level: 'potential', reasons: [LEAF_WARNING] };
  }
  if (loaders.includes('folia')) {
    return { level: 'incompatible', reasons: ['Leaf is a Paper fork, not Folia; Folia-only plugins are not supported.'] };
  }
  return { level: 'potential', reasons: ['Plugin does not declare Leaf or Paper support; compatibility is unconfirmed.'] };
}

function evaluateGameVersions(
  plugin: CompatInput,
  mcVersion: string,
  versionVerified: boolean,
): LoaderEvaluation {
  const versions = (plugin.mcVersions ?? []).filter((v) => typeof v === 'string' && v.trim() !== '');
  if (versions.length === 0) {
    if (plugin.minMcVersion) {
      if (!versionVerified) {
        return {
          level: 'unknown',
          reasons: [`Minecraft ${mcVersion} is not in verified metadata; the plugin requires API ${plugin.minMcVersion}+.`],
        };
      }
      const cmp = compareVersions(mcVersion, plugin.minMcVersion);
      if (cmp < 0) {
        return { level: 'incompatible', reasons: [`Plugin requires Minecraft ${plugin.minMcVersion} or newer.`] };
      }
      return { level: 'potential', reasons: [`Plugin declares api-version ${plugin.minMcVersion}; newer server versions are usually compatible but not verified.`] };
    }
    return { level: 'unknown', reasons: ['Plugin does not list supported Minecraft versions.'] };
  }

  if (versions.includes(mcVersion)) {
    return { level: 'verified', reasons: [`Plugin metadata lists Minecraft ${mcVersion}.`] };
  }
  if (!versionVerified) {
    return {
      level: 'unknown',
      reasons: [`Minecraft ${mcVersion} could not be verified against release metadata, so plugin support cannot be confirmed.`],
    };
  }
  const sorted = [...versions].sort(compareVersions);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  if (compareVersions(mcVersion, min) < 0) {
    return { level: 'incompatible', reasons: [`Plugin supports Minecraft ${min} – ${max}; ${mcVersion} is older than the minimum.`] };
  }
  if (compareVersions(mcVersion, max) > 0) {
    return { level: 'incompatible', reasons: [`Plugin supports Minecraft ${min} – ${max}; ${mcVersion} is newer than the tested range.`] };
  }
  return {
    level: 'potential',
    reasons: [`Minecraft ${mcVersion} is not listed individually (plugin lists ${min} – ${max}).`],
  };
}

export function evaluateCompatibility(
  plugin: CompatInput,
  mcVersion: string,
  software: ServerSoftware,
  options: { versionVerified?: boolean } = {},
): CompatibilityResult {
  const loader = evaluateLoaders(plugin, software);
  const game = evaluateGameVersions(plugin, mcVersion, options.versionVerified ?? true);

  let level: CompatibilityLevel;
  if (loader.level === 'incompatible' || game.level === 'incompatible') level = 'incompatible';
  else if (loader.level === 'verified' && game.level === 'verified') level = 'verified';
  else if (loader.level === 'unknown' && game.level === 'unknown') level = 'unknown';
  else level = 'potential';

  // Defensive: never report verified when either dimension is weaker.
  if (SEVERITY[level] < Math.max(SEVERITY[loader.level], SEVERITY[game.level]) && level !== 'potential') {
    level = loader.level === 'verified' ? game.level : loader.level;
  }

  const reasons = Array.from(new Set([...loader.reasons, ...game.reasons]));
  return { level, reasons, label: compatibilityLabel(level) };
}

export function compatibilityLabel(level: CompatibilityLevel): string {
  switch (level) {
    case 'verified':
      return 'Verified compatible';
    case 'potential':
      return 'Potentially compatible';
    case 'incompatible':
      return 'Incompatible';
    default:
      return 'Unknown compatibility';
  }
}

/** Combines multiple compatibility results, keeping the most severe. */
export function worstCompatibility(results: CompatibilityResult[]): CompatibilityResult {
  if (results.length === 0) return { level: 'unknown', reasons: [], label: compatibilityLabel('unknown') };
  const worst = results.reduce((acc, cur) => (SEVERITY[cur.level] > SEVERITY[acc.level] ? cur : acc), results[0]);
  const reasons = Array.from(new Set(results.flatMap((r) => r.reasons)));
  return { level: worst.level, reasons, label: compatibilityLabel(worst.level) };
}
