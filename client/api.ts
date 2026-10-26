import type {
  AiPlan,
  ExportPreview,
  LibraryPlugin,
  Project,
  ProjectConfig,
  ProjectPlugin,
  ServerSoftware,
  ServerTemplate,
  TemplatePluginRef,
} from '../shared/types';

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData) && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  let response: Response;
  try {
    response = await fetch(`/api${path}`, { ...options, headers, credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'network_error', 'Cannot reach the API server. Is it running?');
  }
  if (response.status === 204) return undefined as T;
  const contentType = response.headers.get('content-type') ?? '';
  const payload = contentType.includes('application/json') ? await response.json().catch(() => null) : null;
  if (!response.ok) {
    const error = payload?.error;
    throw new ApiError(
      response.status,
      error?.code ?? 'http_error',
      error?.message ?? `Request failed with HTTP ${response.status}`,
      error?.details,
    );
  }
  if (!payload) throw new ApiError(response.status, 'bad_response', 'The server returned an unexpected response.');
  return payload as T;
}

export interface ProjectDetail {
  project: Project;
  plugins: ProjectPlugin[];
  configs: ProjectConfig[];
  summary: {
    warnings: { plugin: string; level: string; reasons: string[] }[];
    dependencyIssues: { name: string; forPlugin: string; projectId?: string }[];
    missingFiles: string[];
    compatibility: { level: string; reasons: string[]; label: string };
  };
  dependencies: { missing: { name: string; kind: string; forPlugin: string; projectId?: string }[]; resolved: { name: string; forPlugin: string }[] };
}

export interface MinecraftVersion {
  id: string;
  type: string;
  releaseTime?: string;
  verified: boolean;
}

export interface ModrinthHit {
  id: string;
  slug: string;
  name: string;
  description: string;
  author: string;
  iconUrl: string | null;
  categories: string[];
  mcVersions: string[];
  downloads: number;
  url: string;
}

export interface ModrinthVersion {
  id: string;
  name: string;
  versionNumber: string;
  versionType: string;
  gameVersions: string[];
  loaders: string[];
  publishedAt: string;
  files: { filename: string; size: number; primary: boolean }[];
  dependencies: { projectId: string | null; versionId: string | null; kind: string }[];
}

export interface CategoryInfo {
  name: string;
  builtin: boolean;
  count: number;
}

export interface SettingsPayload {
  settings: Record<string, string>;
  ai: { configured: boolean; provider: string; model: string; reason?: string };
  limits: Record<string, number>;
  storage: { pluginBytes: number; templateBytes: number; dataDirIsRelative: boolean };
  security: Record<string, string>;
}

export interface TemplatePreviewPayload {
  template: ServerTemplate;
  plugins: {
    ref: TemplatePluginRef;
    status: 'available-local' | 'available-modrinth' | 'in-project' | 'unavailable';
    libraryPluginId: string | null;
    libraryName: string | null;
    version: string | null;
    compatibility: { level: string; reasons: string[] };
  }[];
  warnings: string[];
  availableCount: number;
  unavailableCount: number;
}

export interface TabModel {
  headerFooter: { enabled: boolean; header: string[]; footer: string[] };
  tablistNameFormatting: { enabled: boolean; format: string[] };
  playerlistObjective: { enabled: boolean; value: string; title: string; renderType: 'INTEGER' | 'HEARTS'; fancyValue: string; fancyValueDefault: string };
  belownameObjective: { enabled: boolean; value: string; title: string; renderType: 'INTEGER' | 'HEARTS'; fancyValue: string; fancyValueDefault: string };
  scoreboardTeams: {
    enabled: boolean;
    sortingTypes: string[];
    caseSensitiveSorting: boolean;
    unlimitedNametagLength: boolean;
    disableCollision: boolean;
    collisionRule: 'pushOtherTeams' | 'pushOwnTeam' | 'alwaysPush' | 'neverPush';
    teamNameFormat: string;
    invisibleTeamNames: boolean;
    format: string;
  };
  bossbar: {
    enabled: boolean;
    style: 'PROGRESS' | 'NOTCHED_6' | 'NOTCHED_10' | 'NOTCHED_12' | 'NOTCHED_20';
    color: 'PINK' | 'BLUE' | 'RED' | 'GREEN' | 'YELLOW' | 'PURPLE' | 'WHITE';
    progress: string;
    text: string;
  };
  placeholders: { dateFormat: string; timeFormat: string; timeOffset: number };
  outputReplacements: { placeholder: string; replacement: string }[];
  spectatorsDisabled: boolean;
}

export interface TabContext {
  projectId: string;
  tabInstalled: boolean;
  tabVersion: string | null;
  adapter: { supported: boolean; message: string };
  existingConfig: { id: string; content: string; updatedAt: string } | null;
}

export const api = {
  health: () => request<{ status: string }>('/health'),

  listProjects: () => request<{ projects: Project[] }>('/projects'),
  createProject: (body: Record<string, unknown>) => request<{ project: Project; versionWarning?: string }>('/projects', { method: 'POST', body: JSON.stringify(body) }),
  getProject: (id: string) => request<ProjectDetail>(`/projects/${id}`),
  updateProject: (id: string, body: Record<string, unknown>) => request<{ project: Project; plugins: ProjectPlugin[] }>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteProject: (id: string) => request<void>(`/projects/${id}`, { method: 'DELETE' }),
  duplicateProject: (id: string) => request<{ project: Project }>(`/projects/${id}/duplicate`, { method: 'POST' }),

  listPlugins: (id: string) => request<{ plugins: ProjectPlugin[]; dependencies: ProjectDetail['dependencies'] }>(`/projects/${id}/plugins`),
  addPlugin: (id: string, body: Record<string, unknown>) => request<{ plugin: ProjectPlugin; warnings: string[]; createdConfigs: string[] }>(`/projects/${id}/plugins`, { method: 'POST', body: JSON.stringify(body) }),
  batchAddPlugins: (id: string, body: { items: Record<string, unknown>[]; allowIncompatible?: boolean; overwriteConfigs?: boolean }) =>
    request<{ results: { name: string; status: string; error?: string; warnings?: string[] }[]; plugins: ProjectPlugin[]; summary: ProjectDetail['summary'] }>(`/projects/${id}/plugins/batch`, { method: 'POST', body: JSON.stringify(body) }),
  reinstallPlugin: (id: string, pluginId: string) => request<{ plugin: ProjectPlugin }>(`/projects/${id}/plugins/${pluginId}/reinstall`, { method: 'POST' }),
  replacePluginVersion: (id: string, pluginId: string, body: { libraryPluginId?: string; modrinthProjectId?: string; modrinthVersionId?: string }) =>
    request<{ plugin: ProjectPlugin; warnings: string[] }>(`/projects/${id}/plugins/${pluginId}/replace`, { method: 'POST', body: JSON.stringify(body) }),
  resolveDependencies: (id: string) =>
    request<{ installed: { name: string; forPlugin: string }[]; failed: { name: string; reason: string }[]; plugins: ProjectPlugin[]; remaining: ProjectDetail['dependencies'] }>(`/projects/${id}/plugins/resolve-dependencies`, { method: 'POST', body: JSON.stringify({}) }),
  removePlugin: (id: string, pluginId: string, deleteConfigs = false) =>
    request<{ plugins: ProjectPlugin[]; summary: ProjectDetail['summary'] }>(`/projects/${id}/plugins/${pluginId}?deleteConfigs=${deleteConfigs ? 'true' : 'false'}`, { method: 'DELETE' }),
  updatePluginNotes: (id: string, pluginId: string, notes: string) =>
    request<{ plugin: ProjectPlugin }>(`/projects/${id}/plugins/${pluginId}`, { method: 'PATCH', body: JSON.stringify({ notes }) }),

  listConfigs: (id: string) => request<{ configs: ProjectConfig[] }>(`/projects/${id}/configs`),
  createConfig: (id: string, body: Record<string, unknown>) => request<{ config: ProjectConfig }>(`/projects/${id}/configs`, { method: 'POST', body: JSON.stringify(body) }),
  updateConfig: (id: string, configId: string, body: Record<string, unknown>) => request<{ config: ProjectConfig }>(`/projects/${id}/configs/${configId}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteConfig: (id: string, configId: string) => request<void>(`/projects/${id}/configs/${configId}`, { method: 'DELETE' }),
  validateConfig: (id: string, body: { content: string; format: string }) => request<{ valid: boolean; errors: string[]; warnings: string[] }>(`/projects/${id}/configs/validate`, { method: 'POST', body: JSON.stringify(body) }),
  configTemplate: (id: string, configId: string) => request<{ content: string; source: string }>(`/projects/${id}/configs/${configId}/template`),
  resetConfig: (id: string, configId: string) => request<{ config: ProjectConfig }>(`/projects/${id}/configs/${configId}/reset`, { method: 'POST' }),
  importConfig: (id: string, form: FormData) => request<{ config: ProjectConfig; warnings: string[] }>(`/projects/${id}/configs/import`, { method: 'POST', body: form }),

  exportPreview: (id: string, includeTemplateConfigs = true) =>
    request<{ preview: ExportPreview }>(`/projects/${id}/export/preview?includeTemplateConfigs=${includeTemplateConfigs}`),
  exportUrl: (id: string, includeTemplateConfigs = true) =>
    `/api/projects/${id}/export?includeTemplateConfigs=${includeTemplateConfigs}`,

  library: (params: Record<string, string | number | boolean | undefined>) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') search.set(key, String(value));
    }
    return request<{ items: LibraryPlugin[]; total: number; categories: CategoryInfo[] }>(`/plugins/library?${search.toString()}`);
  },
  libraryItem: (id: string) => request<{ plugin: LibraryPlugin }>(`/plugins/library/${id}`),
  libraryUpdate: (id: string, body: Record<string, unknown>) => request<{ plugin: LibraryPlugin }>(`/plugins/library/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  libraryDelete: (id: string, force = false) => request<void>(`/plugins/library/${id}?force=${force}`, { method: 'DELETE' }),
  uploadPlugin: (form: FormData) => request<{ plugin: LibraryPlugin; files?: string[]; inspection?: Record<string, unknown>; kind: string }>('/plugins/library/upload', { method: 'POST', body: form }),
  redownload: (id: string) => request<{ plugin: LibraryPlugin; cached: boolean }>(`/plugins/library/${id}/redownload`, { method: 'POST' }),
  categories: () => request<{ categories: CategoryInfo[] }>('/plugins/categories'),
  addCategory: (name: string) => request<{ categories: CategoryInfo[] }>('/plugins/categories', { method: 'POST', body: JSON.stringify({ name }) }),
  downloadModrinth: (body: Record<string, unknown>) => request<{ plugin: LibraryPlugin; cached: boolean; warnings: string[] }>('/plugins/download', { method: 'POST', body: JSON.stringify(body) }),

  modrinthSearch: (params: Record<string, string | number | undefined>) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== '') search.set(key, String(value));
    return request<{ hits: ModrinthHit[]; totalHits: number }>(`/modrinth/search?${search.toString()}`);
  },
  modrinthVersions: (id: string, params: { mcVersion?: string; loaders?: string } = {}) => {
    const search = new URLSearchParams();
    if (params.mcVersion) search.set('mcVersion', params.mcVersion);
    if (params.loaders) search.set('loaders', params.loaders);
    return request<{ versions: ModrinthVersion[] }>(`/modrinth/versions/${id}?${search.toString()}`);
  },

  minecraftVersions: (software?: string) => request<{ versions: MinecraftVersion[]; warning?: string; cached: boolean; software: { versions: string[]; source: string; warning?: string } | null }>(`/minecraft/versions${software ? `?software=${software}` : ''}`),
  builds: (software: string, version: string) =>
    request<{ builds: { id: string; channel: string; time: string }[]; supported: boolean; warning?: string; source: string; versions: string[] }>(
      `/minecraft/builds?software=${encodeURIComponent(software)}&version=${encodeURIComponent(version)}`,
    ),

  templates: () => request<{ templates: ServerTemplate[] }>('/templates'),
  templatePreview: (id: string, projectId?: string) => request<{ preview: TemplatePreviewPayload }>(`/templates/${id}/preview${projectId ? `?projectId=${projectId}` : ''}`),
  applyTemplate: (id: string, body: Record<string, unknown>) => request<{ added: { name: string }[]; skipped: { name: string; reason: string }[]; failed: { name: string; reason: string }[]; warnings: string[] }>(`/templates/${id}/apply`, { method: 'POST', body: JSON.stringify(body) }),
  createTemplate: (body: Record<string, unknown>) => request<{ template: ServerTemplate }>('/templates', { method: 'POST', body: JSON.stringify(body) }),
  updateTemplate: (id: string, body: Record<string, unknown>) => request<{ template: ServerTemplate }>(`/templates/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteTemplate: (id: string) => request<void>(`/templates/${id}`, { method: 'DELETE' }),
  duplicateTemplate: (id: string, name?: string) => request<{ template: ServerTemplate }>(`/templates/${id}/duplicate`, { method: 'POST', body: JSON.stringify({ name }) }),
  templateFromProject: (projectId: string, name: string, description?: string) =>
    request<{ template: ServerTemplate }>('/templates/from-project', { method: 'POST', body: JSON.stringify({ projectId, name, description }) }),

  aiStatus: () => request<{ configured: boolean; provider: string; model: string; reason?: string; note: string; configuration: { envVars: string[]; providers: string[] } }>('/ai/status'),
  aiPlan: (projectId: string, prompt: string) => request<{ plan: AiPlan }>('/ai/plan', { method: 'POST', body: JSON.stringify({ projectId, prompt }) }),
  aiInstall: (projectId: string, items: { libraryPluginId?: string | null; modrinthProjectId?: string | null; modrinthVersionId?: string | null; name?: string }[], allowIncompatible = false) =>
    request<{ results: { name: string; status: string; error?: string; warnings?: string[] }[]; plugins: ProjectPlugin[] }>('/ai/install-plan', {
      method: 'POST',
      body: JSON.stringify({ projectId, items, allowIncompatible }),
    }),

  tabContext: (projectId: string) => request<TabContext>(`/tab/projects/${projectId}/context`),
  tabModel: () => request<{ model: TabModel; adapter: number }>('/tab/model'),
  tabParse: (content: string) => request<{ model: TabModel; extraSections: Record<string, unknown>; warnings: string[] }>('/tab/parse', { method: 'POST', body: JSON.stringify({ content }) }),
  tabValidate: (model: TabModel, extraSections: Record<string, unknown> = {}) =>
    request<{ valid: boolean; error: string | null; warnings: string[] }>('/tab/validate', { method: 'POST', body: JSON.stringify({ model, extraSections }) }),
  tabGenerate: (model: TabModel, extraSections: Record<string, unknown> = {}) =>
    request<{ content: string; warnings: string[]; extraSections: string[] }>('/tab/generate', { method: 'POST', body: JSON.stringify({ model, extraSections }) }),
  tabSave: (projectId: string, content: string) => request<{ config: ProjectConfig }>(`/tab/projects/${projectId}/save`, { method: 'POST', body: JSON.stringify({ content }) }),
  luckPermsGuide: () => request<{ guide: Record<string, any> }>('/tab/luckperms/guide'),

  settings: () => request<SettingsPayload>('/settings'),
  updateSettings: (settings: Record<string, string>) => request<{ settings: Record<string, string> }>('/settings', { method: 'PUT', body: JSON.stringify({ settings }) }),
};

export const SOFTWARE_LOADERS: Record<ServerSoftware, string> = {
  paper: 'paper,bukkit,spigot',
  folia: 'folia,paper,bukkit,spigot',
  leaf: 'leaf,paper,bukkit,spigot',
};
