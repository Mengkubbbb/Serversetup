import { config } from './config.js';
import { fetchJson, GITHUB_HOSTS, PAPER_HOSTS } from './net.js';
import type { BuildInfo, ServerSoftware, VersionInfo, VersionChannel } from '../shared/types.js';

const CACHE_TTL_MS = 30 * 60 * 1000;
const cache = new Map<string, { at: number; data: unknown }>();

async function cached<T>(key: string, loader: () => Promise<T>): Promise<{ value: T; cached: boolean }> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return { value: hit.data as T, cached: true };
  }
  try {
    const value = await loader();
    cache.set(key, { at: Date.now(), data: value });
    return { value, cached: false };
  } catch (err) {
    if (hit) return { value: hit.data as T, cached: true };
    throw err;
  }
}

export function isCacheWarm(): boolean {
  return cache.size > 0;
}

export function clearMetadataCache(): void {
  cache.clear();
}

interface MojangManifest {
  latest: { release: string; snapshot: string };
  versions: { id: string; type: string; releaseTime: string; time: string }[];
}

export async function getMinecraftVersions(): Promise<{ versions: VersionInfo[]; cached: boolean; warning?: string }> {
  try {
    const { value, cached: isCached } = await cached('mojang-manifest', async () =>
      fetchJson<MojangManifest>('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json', {
        allowedHosts: PAPER_HOSTS,
        timeoutMs: Math.max(config.requestTimeoutMs, 15000),
      }),
    );
    const versions: VersionInfo[] = value.versions
      .filter((v) => ['release', 'snapshot', 'old_beta', 'old_alpha'].includes(v.type))
      .map((v) => ({
        id: v.id,
        type: v.type as VersionInfo['type'],
        releaseTime: v.releaseTime,
        verified: true,
      }));
    return { versions, cached: isCached };
  } catch (err: any) {
    return { versions: [], cached: false, warning: `Minecraft version metadata unavailable: ${err?.message ?? err}` };
  }
}

interface FillProjectResponse {
  project: { id: string; name: string };
  versions: Record<string, string[]>;
}

interface FillBuildResponse {
  id: number;
  time: string;
  channel: string;
  downloads: Record<string, { name: string; size: number; url: string; checksums: Record<string, string> }>;
}

const FILL_PROJECT: Partial<Record<ServerSoftware, string>> = {
  paper: 'paper',
  folia: 'folia',
};

export interface SoftwareMetadata {
  versions: string[];
  builds: BuildInfo[];
  source: string;
  warning?: string;
  buildsAvailable: boolean;
}

export async function getSoftwareVersions(software: ServerSoftware): Promise<{ versions: string[]; source: string; warning?: string; cached: boolean }> {
  if (software === 'leaf') {
    try {
      const { value, cached: isCached } = await cached('leaf-releases', async () =>
        fetchJson<{ tag_name: string; name: string; prerelease: boolean; published_at: string }[]>(
          'https://api.github.com/repos/Winds-Studio/Leaf/releases?per_page=60',
          {
            allowedHosts: GITHUB_HOSTS,
            headers: config.githubToken ? { authorization: `Bearer ${config.githubToken}` } : {},
          },
        ),
      );
      const versions = Array.from(
        new Set(
          value
            .map((release) => release.tag_name.replace(/^v/i, '').trim())
            .filter((tag) => /^\d+\.\d+(\.\d+)?$/.test(tag)),
        ),
      );
      return {
        versions,
        source: 'GitHub releases (Winds-Studio/Leaf)',
        cached: isCached,
        warning: versions.length === 0 ? 'No Leaf releases could be parsed from GitHub metadata.' : undefined,
      };
    } catch (err: any) {
      return {
        versions: [],
        source: 'GitHub releases (Winds-Studio/Leaf)',
        cached: false,
        warning: `Leaf build metadata is unavailable (${err?.message ?? err}). Enter a build manually or set GITHUB_TOKEN to lift rate limits.`,
      };
    }
  }

  const projectId = FILL_PROJECT[software] ?? software;
  try {
    const { value, cached: isCached } = await cached(`fill-project-${projectId}`, async () =>
      fetchJson<FillProjectResponse>(`https://fill.papermc.io/v3/projects/${projectId}`, { allowedHosts: PAPER_HOSTS }),
    );
    const versions = Array.from(new Set(Object.values(value.versions ?? {}).flat())).sort(compareVersionsDesc);
    return { versions, source: `PaperMC Fill v3 (${projectId})`, cached: isCached };
  } catch (err: any) {
    return {
      versions: [],
      source: `PaperMC Fill v3 (${projectId})`,
      cached: false,
      warning: `PaperMC metadata for ${software} is unavailable: ${err?.message ?? err}`,
    };
  }
}

export async function getBuilds(software: ServerSoftware, version: string): Promise<SoftwareMetadata> {
  if (software === 'leaf') {
    try {
      const { value } = await cached('leaf-releases', async () =>
        fetchJson<{ tag_name: string; name: string; prerelease: boolean; published_at: string }[]>(
          'https://api.github.com/repos/Winds-Studio/Leaf/releases?per_page=60',
          {
            allowedHosts: GITHUB_HOSTS,
            headers: config.githubToken ? { authorization: `Bearer ${config.githubToken}` } : {},
          },
        ),
      );
      const builds = value
        .filter((release) => release.tag_name.replace(/^v/i, '').trim() === version)
        .map((release) => ({
          id: release.tag_name.replace(/^v/i, ''),
          channel: release.prerelease ? 'PRERELEASE' : 'RELEASE',
          time: release.published_at,
        }));
      return {
        versions: [],
        builds,
        source: 'GitHub releases (Winds-Studio/Leaf)',
        buildsAvailable: builds.length > 0,
        warning: builds.length === 0 ? 'No Leaf build metadata found for this version. You can enter a build manually.' : undefined,
      };
    } catch (err: any) {
      return {
        versions: [],
        builds: [],
        source: 'GitHub releases (Winds-Studio/Leaf)',
        buildsAvailable: false,
        warning: `Leaf build metadata unavailable: ${err?.message ?? err}`,
      };
    }
  }

  const projectId = FILL_PROJECT[software] ?? software;
  try {
    const { value } = await cached(`fill-builds-${projectId}-${version}`, async () =>
      fetchJson<FillBuildResponse[]>(
        `https://fill.papermc.io/v3/projects/${projectId}/versions/${encodeURIComponent(version)}/builds`,
        { allowedHosts: PAPER_HOSTS },
      ),
    );
    const builds = (Array.isArray(value) ? value : []).map((build) => ({
      id: String(build.id),
      channel: build.channel,
      time: build.time,
    }));
    return {
      versions: [],
      builds,
      source: `PaperMC Fill v3 (${projectId})`,
      buildsAvailable: builds.length > 0,
      warning: builds.length === 0 ? 'No builds published for this version.' : undefined,
    };
  } catch (err: any) {
    return {
      versions: [],
      builds: [],
      source: `PaperMC Fill v3 (${projectId})`,
      buildsAvailable: false,
      warning: `Build metadata unavailable: ${err?.message ?? err}`,
    };
  }
}

export function compareVersionsDesc(a: string, b: string): number {
  return compareVersions(b, a);
}

export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < Math.max(pa.numbers.length, pb.numbers.length); i++) {
    const diff = (pa.numbers[i] ?? 0) - (pb.numbers[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return pa.pre.localeCompare(pb.pre);
}

function parseVersion(version: string): { numbers: number[]; pre: string } {
  const [base, ...rest] = version.trim().replace(/^v/i, '').split('-');
  const numbers = base.split('.').map((n) => Number.parseInt(n, 10) || 0);
  return { numbers, pre: rest.join('-') };
}

const VERSION_PATTERN =
  /^(\d{1,2}\.\d{1,2}(\.\d{1,2})?|\d{2}w\d{2}[a-z])(-(pre|rc|snapshot)[a-z0-9.\-]*)?$/i;

export function isValidMinecraftVersion(version: string): boolean {
  return VERSION_PATTERN.test(version.trim());
}

export function detectVersionChannelFromMetadata(version: string, versions: VersionInfo[]): VersionChannel {
  const match = versions.find((v) => v.id === version);
  if (!match) return 'custom';
  if (match.type === 'release') return 'release';
  if (match.type === 'snapshot') return 'snapshot';
  return 'prerelease';
}

export function normalizeSoftware(value: string): ServerSoftware | null {
  const lower = value.toLowerCase();
  if (lower === 'paper' || lower === 'folia' || lower === 'leaf') return lower;
  return null;
}
