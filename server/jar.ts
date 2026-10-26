import path from 'node:path';
import { readZipEntry } from './safety.js';
import { isPlainObject, parseYamlSafe } from './yaml.js';

export interface JarInspection {
  isBukkitPlugin: boolean;
  manifestName: string | null;
  pluginYml: string | null;
  name: string | null;
  version: string | null;
  main: string | null;
  apiVersion: string | null;
  authors: string[];
  description: string;
  website: string;
  depends: string[];
  softDepends: string[];
  foliaSupported: boolean | null;
  commands: string[];
  permissions: string[];
  loaders: string[];
  warnings: string[];
}

const EMPTY: JarInspection = {
  isBukkitPlugin: false,
  manifestName: null,
  pluginYml: null,
  name: null,
  version: null,
  main: null,
  apiVersion: null,
  authors: [],
  description: '',
  website: '',
  depends: [],
  softDepends: [],
  foliaSupported: null,
  commands: [],
  permissions: [],
  loaders: [],
  warnings: [],
};

function toStringArray(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  return [];
}

/** Reads plugin.yml / paper-plugin.yml from a JAR. It is never executed. */
export async function inspectJar(jarPath: string): Promise<JarInspection> {
  const warnings: string[] = [];
  let entry: { fileName: string; buffer: Buffer } | null = null;
  for (const candidate of [/^plugin\.yml$/i, /^paper-plugin\.yml$/i]) {
    entry = await readZipEntry(jarPath, (name) => candidate.test(name), 1024 * 1024);
    if (entry) break;
  }
  const descriptor = entry;
  if (!descriptor) {
    return { ...EMPTY, warnings: ['No plugin.yml or paper-plugin.yml was found; this may not be a Bukkit/Paper plugin.'] };
  }

  let data: Record<string, unknown> | null = null;
  try {
    const parsed = parseYamlSafe(descriptor.buffer.toString('utf8'));
    if (isPlainObject(parsed)) data = parsed;
  } catch (err: any) {
    warnings.push(`plugin descriptor could not be parsed: ${err?.message ?? err}`);
  }
  if (!data) {
    return { ...EMPTY, pluginYml: descriptor.fileName, manifestName: path.basename(jarPath), warnings };
  }

  const apiVersionRaw = data['api-version'];
  const apiVersion =
    typeof apiVersionRaw === 'number'
      ? String(apiVersionRaw)
      : typeof apiVersionRaw === 'string'
        ? apiVersionRaw
        : null;

  const authors = [...toStringArray(data.authors), ...toStringArray(data.author)];
  const foliaRaw = data['folia-supported'];

  return {
    isBukkitPlugin: true,
    manifestName: null,
    pluginYml: descriptor.fileName,
    name: typeof data.name === 'string' ? data.name : null,
    version: typeof data.version === 'string' ? data.version : typeof data.version === 'number' ? String(data.version) : null,
    main: typeof data.main === 'string' ? data.main : null,
    apiVersion,
    authors: Array.from(new Set(authors)),
    description: typeof data.description === 'string' ? data.description : '',
    website: typeof data.website === 'string' ? data.website : '',
    depends: toStringArray(data.depend),
    softDepends: toStringArray(data.softdepend),
    foliaSupported: typeof foliaRaw === 'boolean' ? foliaRaw : null,
    commands: isPlainObject(data.commands) ? Object.keys(data.commands) : [],
    permissions: isPlainObject(data.permissions) ? Object.keys(data.permissions) : [],
    loaders: [],
    warnings,
  };
}
