export type Language = 'en' | 'th';
export type ServerSoftware = 'paper' | 'folia' | 'leaf';
export type VersionChannel = 'release' | 'prerelease' | 'snapshot' | 'custom';
export type CompatibilityLevel = 'verified' | 'potential' | 'incompatible' | 'unknown';
export type PluginSource = 'modrinth' | 'local';

export interface PluginDependency {
  projectId?: string;
  versionId?: string;
  name?: string;
  kind: 'required' | 'optional' | 'incompatible' | 'embedded' | 'unknown';
}

export interface LibraryPlugin {
  id: string;
  source: PluginSource;
  sourceProjectId: string | null;
  sourceVersionId: string | null;
  sourceUrl: string | null;
  name: string;
  slug: string | null;
  description: string;
  author: string;
  version: string | null;
  mcVersions: string[];
  loaders: string[];
  foliaCompatible: boolean | null;
  categories: string[];
  fileName: string | null;
  fileHash: string | null;
  fileSize: number | null;
  iconUrl: string | null;
  projectUrl: string | null;
  dependencies: PluginDependency[];
  notes: string;
  configTemplateDir: string | null;
  hasFile: boolean;
  fileMissing: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CompatibilityResult {
  level: CompatibilityLevel;
  reasons: string[];
  label: string;
}

export interface ProjectPlugin {
  id: string;
  projectId: string;
  libraryPluginId: string | null;
  sourceProjectId: string | null;
  sourceSlug: string | null;
  displayName: string;
  version: string | null;
  source: PluginSource;
  fileName: string;
  configDir: string | null;
  status: 'installed' | 'missing';
  notes: string;
  hasWarnings: boolean;
  compatibility: CompatibilityResult;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectConfig {
  id: string;
  projectId: string;
  pluginId: string | null;
  path: string;
  format: 'yaml' | 'json' | 'toml' | 'text';
  content: string;
  origin: 'user' | 'template' | 'imported' | 'generated';
  updatedAt: string;
}

export interface Project {
  id: string;
  name: string;
  serverName: string;
  description: string;
  icon: string | null;
  language: Language;
  mcVersion: string;
  versionChannel: VersionChannel;
  versionVerified: boolean;
  software: ServerSoftware;
  softwareBuild: string | null;
  templateId: string | null;
  templateName?: string | null;
  createdAt: string;
  updatedAt: string;
  pluginCount?: number;
  missingPluginCount?: number;
  warningCount?: number;
}

export interface TemplatePluginRef {
  name: string;
  slug?: string;
  modrinthSlug?: string;
  versionConstraint?: string;
  required: boolean;
  category?: string;
  note?: string;
}

export interface ServerTemplate {
  id: string;
  name: string;
  description: string;
  categories: string[];
  mcVersions: string[];
  software: ServerSoftware | null;
  plugins: TemplatePluginRef[];
  warnings: string[];
  notes: string;
  builtin: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface VersionInfo {
  id: string;
  type: VersionChannel | 'old_beta' | 'old_alpha';
  releaseTime?: string;
  verified: boolean;
}

export interface BuildInfo {
  id: string;
  channel: string;
  time: string;
  downloads?: number;
}

export interface MetadataResponse {
  mcVersions: VersionInfo[];
  softwareVersions: string[];
  supportedVersions: string[];
  builds: BuildInfo[];
  source: string;
  warning?: string;
  fetchedAt: string;
  cached: boolean;
}

export interface ExportPreviewEntry {
  path: string;
  size: number;
  source: 'plugin-jar' | 'config';
  plugin: string;
}

export interface ExportPreview {
  fileName: string;
  entries: ExportPreviewEntry[];
  collisions: { path: string; from: string[] }[];
  errors: string[];
  warnings: string[];
  fileCount: number;
  totalBytes: number;
}

export interface AiPlanItem {
  candidateId: string;
  libraryPluginId: string | null;
  name: string;
  source: PluginSource | null;
  reason: string;
  category: string;
  compatibility: CompatibilityResult;
  versionId: string | null;
  fileAvailable: boolean;
  warnings: string[];
}

export interface AiPlan {
  prompt: string;
  summary: string;
  detected: { mcVersion?: string; software?: ServerSoftware };
  items: AiPlanItem[];
  unresolved: string[];
  warnings: string[];
  duplicatesAvoided: string[];
  provider: { provider: string; model: string };
  candidateCount: number;
  createdAt: string;
}
