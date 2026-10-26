import yaml from 'js-yaml';

/**
 * Parses YAML with the JSON schema only: no custom tags, no code execution,
 * no anchors resolving into unexpected types.
 */
export function parseYamlSafe<T = unknown>(input: string): T {
  if (typeof input !== 'string') throw new Error('Not a string');
  if (input.length > 2 * 1024 * 1024) throw new Error('YAML document is too large (2 MiB limit).');
  if (/^\s*%TAG/m.test(input)) throw new Error('YAML TAG directives are not allowed.');
  return yaml.load(input, { schema: yaml.JSON_SCHEMA }) as T;
}

export function dumpYaml(value: unknown): string {
  return yaml.dump(value, {
    schema: yaml.JSON_SCHEMA,
    indent: 2,
    lineWidth: 120,
    noRefs: true,
    quotingType: '"',
    forceQuotes: false,
    sortKeys: false,
  });
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
