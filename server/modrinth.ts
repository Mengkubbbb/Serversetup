import { config } from './config.js';
import { fetchJson, MODRINTH_HOSTS } from './net.js';
import { HttpError } from './util.js';

export interface ModrinthSearchHit {
  project_id: string;
  slug: string;
  title: string;
  description: string;
  author: string;
  categories: string[];
  display_categories?: string[];
  versions: string[];
  icon_url: string | null;
  project_type: string;
  all_project_types?: string[];
  downloads: number;
  follows: number;
  date_modified: string;
}

export interface ModrinthSearchResponse {
  hits: ModrinthSearchHit[];
  offset: number;
  limit: number;
  total_hits: number;
}

export interface ModrinthVersionFile {
  hashes: Record<string, string>;
  url: string;
  filename: string;
  primary: boolean;
  size: number;
}

export interface ModrinthVersion {
  id: string;
  project_id: string;
  name: string;
  version_number: string;
  version_type: string;
  game_versions: string[];
  loaders: string[];
  date_published: string;
  files: ModrinthVersionFile[];
  dependencies: { version_id: string | null; project_id: string | null; file_name: string | null; dependency_type: string }[];
}

export interface ModrinthProject {
  id: string;
  slug: string;
  title: string;
  description: string;
  body?: string;
  categories: string[];
  client_side: string;
  server_side: string;
  game_versions: string[];
  loaders: string[];
  project_type: string;
  downloads: number;
  icon_url: string | null;
  team?: string;
  source_url?: string | null;
  issues_url?: string | null;
  wiki_url?: string | null;
  discord_url?: string | null;
  license?: { id: string; name: string };
}

const headers = { 'user-agent': config.modrinthUserAgent };

function facetsFor(options: { mcVersion?: string; categories?: string[]; loaders?: string[]; openSource?: boolean }): string {
  const groups: string[][] = [['project_type:plugin']];
  if (options.mcVersion) groups.push([`versions:${options.mcVersion}`]);
  if (options.categories?.length) groups.push(options.categories.map((c) => `categories:${c}`));
  if (options.loaders?.length) groups.push(options.loaders.map((l) => `categories:${l}`));
  if (options.openSource) groups.push(['open_source:true']);
  return JSON.stringify(groups);
}

export async function searchModrinth(options: {
  query?: string;
  limit?: number;
  offset?: number;
  mcVersion?: string;
  categories?: string[];
  loaders?: string[];
  openSource?: boolean;
}): Promise<ModrinthSearchResponse> {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 50);
  const offset = Math.max(options.offset ?? 0, 0);
  const params = new URLSearchParams({
    query: options.query?.trim() ?? '',
    limit: String(limit),
    offset: String(offset),
    index: 'relevance',
    facets: facetsFor(options),
  });
  return fetchJson<ModrinthSearchResponse>(`https://api.modrinth.com/v2/search?${params.toString()}`, {
    allowedHosts: MODRINTH_HOSTS,
    headers,
  });
}

export async function getModrinthProject(idOrSlug: string): Promise<ModrinthProject> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(idOrSlug)) throw new HttpError(400, 'bad_request', 'Invalid Modrinth project identifier.');
  return fetchJson<ModrinthProject>(`https://api.modrinth.com/v2/project/${encodeURIComponent(idOrSlug)}`, {
    allowedHosts: MODRINTH_HOSTS,
    headers,
  });
}

export async function getModrinthVersions(
  idOrSlug: string,
  filters: { loaders?: string[]; mcVersion?: string } = {},
): Promise<ModrinthVersion[]> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(idOrSlug)) throw new HttpError(400, 'bad_request', 'Invalid Modrinth project identifier.');
  const params = new URLSearchParams();
  if (filters.loaders?.length) params.set('loaders', JSON.stringify(filters.loaders));
  if (filters.mcVersion) params.set('game_versions', JSON.stringify([filters.mcVersion]));
  const query = params.toString();
  return fetchJson<ModrinthVersion[]>(
    `https://api.modrinth.com/v2/project/${encodeURIComponent(idOrSlug)}/version${query ? `?${query}` : ''}`,
    { allowedHosts: MODRINTH_HOSTS, headers },
  );
}

export async function getModrinthVersion(versionId: string): Promise<ModrinthVersion> {
  if (!/^[A-Za-z0-9]{1,32}$/.test(versionId)) throw new HttpError(400, 'bad_request', 'Invalid Modrinth version identifier.');
  return fetchJson<ModrinthVersion>(`https://api.modrinth.com/v2/version/${encodeURIComponent(versionId)}`, {
    allowedHosts: MODRINTH_HOSTS,
    headers,
  });
}

export function selectPrimaryFile(version: ModrinthVersion): ModrinthVersionFile | null {
  const files = version.files ?? [];
  if (files.length === 0) return null;
  const jar = files.find((f) => f.primary && f.filename.toLowerCase().endsWith('.jar'));
  return jar ?? files.find((f) => f.filename.toLowerCase().endsWith('.jar')) ?? files.find((f) => f.primary) ?? files[0] ?? null;
}

export function mapSearchHit(hit: ModrinthSearchHit) {
  return {
    id: hit.project_id,
    slug: hit.slug,
    name: hit.title,
    description: hit.description,
    author: hit.author,
    iconUrl: hit.icon_url,
    categories: hit.display_categories ?? hit.categories,
    mcVersions: hit.versions ?? [],
    downloads: hit.downloads,
    url: `https://modrinth.com/plugin/${hit.slug}`,
  };
}
