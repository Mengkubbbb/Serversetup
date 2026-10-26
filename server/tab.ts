import { z } from 'zod';
import { dumpYaml, isPlainObject, parseYamlSafe } from './yaml.js';
import { compareVersions } from './mcmeta.js';

/**
 * TAB configuration adapter.
 *
 * Only the TAB 5.x configuration layout is generated (the layout used by
 * current TAB releases): header-footer, tablist-name-formatting,
 * playerlist-objective, belowname-objective, scoreboard-teams, bossbar,
 * placeholders, placeholder-output-replacements and prevent-spectator-effect.
 * Unknown top-level sections from imported configs are preserved verbatim.
 */
export const TAB_ADAPTER_VERSION = 5;

export const tabLine = z.string().max(1024);
export const tabModelSchema = z.object({
  headerFooter: z.object({
    enabled: z.boolean(),
    header: z.array(tabLine).max(40),
    footer: z.array(tabLine).max(40),
  }),
  tablistNameFormatting: z.object({
    enabled: z.boolean(),
    format: z.array(tabLine).min(1).max(20),
  }),
  playerlistObjective: z.object({
    enabled: z.boolean(),
    value: z.string().max(256),
    title: z.string().max(64),
    renderType: z.enum(['INTEGER', 'HEARTS']),
    fancyValue: z.string().max(256).default(''),
    fancyValueDefault: z.string().max(256).default(''),
  }),
  belownameObjective: z.object({
    enabled: z.boolean(),
    value: z.string().max(256),
    title: z.string().max(64),
    renderType: z.enum(['INTEGER', 'HEARTS']),
    fancyValue: z.string().max(256).default(''),
    fancyValueDefault: z.string().max(256).default(''),
  }),
  scoreboardTeams: z.object({
    enabled: z.boolean(),
    sortingTypes: z.array(z.string().max(120)).max(10),
    caseSensitiveSorting: z.boolean(),
    unlimitedNametagLength: z.boolean(),
    disableCollision: z.boolean(),
    collisionRule: z.enum(['pushOtherTeams', 'pushOwnTeam', 'alwaysPush', 'neverPush']),
    teamNameFormat: z.string().max(64),
    invisibleTeamNames: z.boolean(),
    format: z.string().max(512),
  }),
  bossbar: z.object({
    enabled: z.boolean(),
    style: z.enum(['PROGRESS', 'NOTCHED_6', 'NOTCHED_10', 'NOTCHED_12', 'NOTCHED_20']),
    color: z.enum(['PINK', 'BLUE', 'RED', 'GREEN', 'YELLOW', 'PURPLE', 'WHITE']),
    progress: z.string().max(64),
    text: z.string().max(256),
  }),
  placeholders: z.object({
    dateFormat: z.string().max(64),
    timeFormat: z.string().max(64),
    timeOffset: z.number().int().min(-24).max(24),
  }),
  outputReplacements: z.array(z.object({ placeholder: z.string().min(1).max(128), replacement: z.string().max(512) })).max(50),
  spectatorsDisabled: z.boolean(),
});

export type TabModel = z.infer<typeof tabModelSchema>;

export const defaultTabModel: TabModel = {
  headerFooter: {
    enabled: true,
    header: ['&6&lMy Minecraft Server', '&7Welcome, &f%player%'],
    footer: ['&8play.example.com', '&7Ping: &a%ping%ms'],
  },
  tablistNameFormatting: { enabled: true, format: ['%luckperms_prefix%&f%player%'] },
  playerlistObjective: {
    enabled: true,
    value: '%ping%',
    title: 'Ping',
    renderType: 'INTEGER',
    fancyValue: '',
    fancyValueDefault: '',
  },
  belownameObjective: {
    enabled: false,
    value: '%health%',
    title: 'Health',
    renderType: 'HEARTS',
    fancyValue: '',
    fancyValueDefault: '',
  },
  scoreboardTeams: {
    enabled: true,
    sortingTypes: ['GROUPS:owner', 'PLACEHOLDER_A_TO_Z:%player%'],
    caseSensitiveSorting: true,
    unlimitedNametagLength: false,
    disableCollision: false,
    collisionRule: 'pushOtherTeams',
    teamNameFormat: 'team_%player%',
    invisibleTeamNames: false,
    format: '%luckperms_prefix%&f%player%',
  },
  bossbar: {
    enabled: false,
    style: 'PROGRESS',
    color: 'BLUE',
    progress: '100',
    text: '&6Welcome to the server, &f%player%',
  },
  placeholders: { dateFormat: 'dd.MM.yyyy', timeFormat: '[HH:mm:ss / h:mm a]', timeOffset: 0 },
  outputReplacements: [{ placeholder: '%server_online%', replacement: '' }],
  spectatorsDisabled: false,
};

export function tabAdapterForVersion(pluginVersion: string | null | undefined): { supported: boolean; message: string } {
  if (!pluginVersion) {
    return {
      supported: true,
      message: 'No TAB plugin version is attached to this project. The editor generates the TAB 5.x layout — verify it against the version you install.',
    };
  }
  const clean = pluginVersion.replace(/^v/i, '').split(/[+\s-]/)[0];
  if (!/^\d+(\.\d+)*$/.test(clean)) {
    return { supported: true, message: `TAB version "${pluginVersion}" could not be parsed; the TAB 5.x layout is used.` };
  }
  if (compareVersions(clean, '5.0.0') >= 0) {
    return { supported: true, message: `Generating the TAB 5.x configuration layout for TAB ${pluginVersion}.` };
  }
  return {
    supported: false,
    message: `TAB ${pluginVersion} uses an older configuration layout. This editor only generates TAB 5.x layouts; use the generic configuration editor to preserve the existing format.`,
  };
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function strList(value: unknown, fallback: string[]): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  return fallback;
}

export interface TabParseResult {
  model: TabModel;
  extraSections: Record<string, unknown>;
  warnings: string[];
  recognizedSections: string[];
}

/** Parses an existing TAB config, keeping unknown sections for round-tripping. */
export function parseTabYaml(text: string): TabParseResult {
  const data = parseYamlSafe<unknown>(text);
  if (!isPlainObject(data)) throw new Error('TAB configuration must be a YAML mapping.');
  const warnings: string[] = [];
  const model: TabModel = JSON.parse(JSON.stringify(defaultTabModel));
  const recognized = new Set<string>();

  const section = (key: string): Record<string, unknown> | null => {
    const value = data[key];
    if (isPlainObject(value)) {
      recognized.add(key);
      return value;
    }
    if (value !== undefined) warnings.push(`Section "${key}" has an unexpected type and was preserved unchanged.`);
    return null;
  };

  const hf = section('header-footer');
  if (hf) {
    model.headerFooter = {
      enabled: bool(hf.enabled, model.headerFooter.enabled),
      header: strList(hf.header, model.headerFooter.header),
      footer: strList(hf.footer, model.headerFooter.footer),
    };
  }

  const tnf = section('tablist-name-formatting');
  if (tnf) {
    model.tablistNameFormatting = {
      enabled: bool(tnf.enabled, model.tablistNameFormatting.enabled),
      format: strList(tnf.format, model.tablistNameFormatting.format),
    };
  }

  const objective = (key: string) => {
    const obj = section(key);
    if (!obj) return null;
    return {
      enabled: bool(obj.enabled, true),
      value: str(obj.value, ''),
      title: str(obj.title, ''),
      renderType: obj['render-type'] === 'HEARTS' ? ('HEARTS' as const) : ('INTEGER' as const),
      fancyValue: str(obj['fancy-value'], ''),
      fancyValueDefault: str(obj['fancy-value-default'], ''),
    };
  };

  const plo = objective('playerlist-objective');
  if (plo) model.playerlistObjective = plo;
  const bno = objective('belowname-objective');
  if (bno) model.belownameObjective = bno;

  const teams = section('scoreboard-teams');
  if (teams) {
    model.scoreboardTeams = {
      enabled: bool(teams.enabled, model.scoreboardTeams.enabled),
      sortingTypes: strList(teams['sorting-types'], model.scoreboardTeams.sortingTypes),
      caseSensitiveSorting: bool(teams['case-sensitive-sorting'], model.scoreboardTeams.caseSensitiveSorting),
      unlimitedNametagLength: bool(teams['unlimited-nametag-length'], model.scoreboardTeams.unlimitedNametagLength),
      disableCollision: bool(teams['disable-collision'], model.scoreboardTeams.disableCollision),
      collisionRule: ['pushOtherTeams', 'pushOwnTeam', 'alwaysPush', 'neverPush'].includes(str(teams['collision-rule']))
        ? (str(teams['collision-rule']) as TabModel['scoreboardTeams']['collisionRule'])
        : model.scoreboardTeams.collisionRule,
      teamNameFormat: str(teams['team-name-format'], model.scoreboardTeams.teamNameFormat),
      invisibleTeamNames: bool(teams['invisible-team-names'], model.scoreboardTeams.invisibleTeamNames),
      format: str(teams.format, model.scoreboardTeams.format),
    };
  }

  const bossbar = section('bossbar');
  if (bossbar) {
    const bars = isPlainObject(bossbar.bars) ? bossbar.bars : null;
    const firstBar = bars && isPlainObject(bars.default) ? (bars.default as Record<string, unknown>) : null;
    if (bars) {
      recognized.add('bossbar.bars');
      const otherBars = Object.keys(bars).filter((k) => k !== 'default');
      if (otherBars.length > 0) {
        warnings.push(`Additional bossbar definitions (${otherBars.join(', ')}) are preserved unchanged.`);
      }
    }
    const source = firstBar ?? bossbar;
    model.bossbar = {
      enabled: bool(bossbar.enabled, model.bossbar.enabled),
      style: (['PROGRESS', 'NOTCHED_6', 'NOTCHED_10', 'NOTCHED_12', 'NOTCHED_20'] as const).includes(str(source.style) as any)
        ? (str(source.style) as TabModel['bossbar']['style'])
        : model.bossbar.style,
      color: (['PINK', 'BLUE', 'RED', 'GREEN', 'YELLOW', 'PURPLE', 'WHITE'] as const).includes(str(source.color) as any)
        ? (str(source.color) as TabModel['bossbar']['color'])
        : model.bossbar.color,
      progress: str(source.progress, model.bossbar.progress),
      text: str(source.text, model.bossbar.text),
    };
  }

  const placeholders = section('placeholders');
  if (placeholders) {
    model.placeholders = {
      dateFormat: str(placeholders['date-format'], model.placeholders.dateFormat),
      timeFormat: str(placeholders['time-format'], model.placeholders.timeFormat),
      timeOffset: num(placeholders['time-offset'], model.placeholders.timeOffset),
    };
    const otherKeys = Object.keys(placeholders).filter(
      (k) => !['date-format', 'time-format', 'time-offset'].includes(k),
    );
    if (otherKeys.length > 0) {
      warnings.push(`Extra placeholder settings (${otherKeys.join(', ')}) are preserved unchanged.`);
    }
  }

  const replacements = section('placeholder-output-replacements');
  if (replacements) {
    const entries: TabModel['outputReplacements'] = [];
    for (const [key, value] of Object.entries(replacements)) {
      if (typeof value === 'string') entries.push({ placeholder: key, replacement: value });
      else if (isPlainObject(value)) {
        const values = Object.values(value).filter((v): v is string => typeof v === 'string');
        entries.push({ placeholder: key, replacement: values[0] ?? '' });
        if (Object.keys(value).length > 1) {
          warnings.push(`Placeholder replacement "${key}" has conditional values; only the first entry is editable here and the full map is preserved on export.`);
        }
      }
    }
    model.outputReplacements = entries;
  }

  const spectator = section('prevent-spectator-effect');
  if (spectator) model.spectatorsDisabled = bool(spectator.enabled, model.spectatorsDisabled);

  const extraSections: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (!recognized.has(key)) extraSections[key] = value;
  }
  if (Object.keys(extraSections).length > 0) {
    warnings.push(
      `Unsupported section(s) preserved unchanged: ${Object.keys(extraSections).join(', ')}. They are written back on export.`,
    );
  }

  return { model, extraSections, warnings, recognizedSections: Array.from(recognized) };
}

export interface TabGenerateResult {
  content: string;
  warnings: string[];
  extraSections: string[];
}

export function validateTabModel(model: TabModel): string[] {
  const warnings: string[] = [];
  const lines = [
    ...model.headerFooter.header,
    ...model.headerFooter.footer,
    ...model.tablistNameFormatting.format,
    model.scoreboardTeams.format,
    model.bossbar.text,
  ];
  for (const line of lines) {
    const placeholderOpen = (line.match(/%/g) ?? []).length;
    if (placeholderOpen % 2 !== 0) warnings.push(`Unclosed placeholder percentage in "${line}".`);
    if (line.length > 256) warnings.push('Some lines are longer than 256 characters; Minecraft may truncate them.');
    if (/\u00a7/.test(line)) warnings.push('The line contains a literal § character; prefer & color codes for portability.');
  }
  if (!model.tablistNameFormatting.enabled && !model.scoreboardTeams.enabled) {
    warnings.push('Both tablist name formatting and scoreboard teams are disabled; prefixes/suffixes will not be displayed.');
  }
  if (model.scoreboardTeams.enabled && !model.scoreboardTeams.format.includes('%player%')) {
    warnings.push('The team format does not contain %player%; player names may not be displayed correctly.');
  }
  if (model.bossbar.enabled && !/^\d{1,3}(\.\d+)?$/.test(model.bossbar.progress.trim()) && !model.bossbar.progress.startsWith('%')) {
    warnings.push('Bossbar progress should be a number from 0 to 100 or a placeholder.');
  }
  return Array.from(new Set(warnings));
}

export function generateTabYaml(model: TabModel, extraSections: Record<string, unknown> = {}): TabGenerateResult {
  const warnings = validateTabModel(model);
  const output: Record<string, unknown> = {
    'header-footer': {
      enabled: model.headerFooter.enabled,
      header: model.headerFooter.header,
      footer: model.headerFooter.footer,
    },
    'tablist-name-formatting': {
      enabled: model.tablistNameFormatting.enabled,
      format: model.tablistNameFormatting.format,
    },
    'playerlist-objective': {
      enabled: model.playerlistObjective.enabled,
      value: model.playerlistObjective.value,
      'fancy-value': model.playerlistObjective.fancyValue,
      'fancy-value-default': model.playerlistObjective.fancyValueDefault,
      title: model.playerlistObjective.title,
      'render-type': model.playerlistObjective.renderType,
    },
    'belowname-objective': {
      enabled: model.belownameObjective.enabled,
      value: model.belownameObjective.value,
      'fancy-value': model.belownameObjective.fancyValue,
      'fancy-value-default': model.belownameObjective.fancyValueDefault,
      title: model.belownameObjective.title,
      'render-type': model.belownameObjective.renderType,
    },
    'scoreboard-teams': {
      enabled: model.scoreboardTeams.enabled,
      'sorting-types': model.scoreboardTeams.sortingTypes,
      'case-sensitive-sorting': model.scoreboardTeams.caseSensitiveSorting,
      'unlimited-nametag-length': model.scoreboardTeams.unlimitedNametagLength,
      'disable-collision': model.scoreboardTeams.disableCollision,
      'collision-rule': model.scoreboardTeams.collisionRule,
      'team-name-format': model.scoreboardTeams.teamNameFormat,
      'invisible-team-names': model.scoreboardTeams.invisibleTeamNames,
      format: model.scoreboardTeams.format,
    },
    bossbar: {
      enabled: model.bossbar.enabled,
      bars: {
        default: {
          style: model.bossbar.style,
          color: model.bossbar.color,
          progress: model.bossbar.progress,
          text: model.bossbar.text,
        },
      },
    },
    'prevent-spectator-effect': { enabled: model.spectatorsDisabled },
    placeholders: {
      'date-format': model.placeholders.dateFormat,
      'time-format': model.placeholders.timeFormat,
      'time-offset': model.placeholders.timeOffset,
    },
    'placeholder-output-replacements': Object.fromEntries(
      model.outputReplacements.filter((r) => r.placeholder.trim() !== '').map((r) => [r.placeholder, r.replacement]),
    ),
  };

  for (const [key, value] of Object.entries(extraSections)) {
    if (key in output) continue;
    output[key] = value;
  }

  const content = dumpYaml(output);
  // Re-validate the generated document so we can never emit invalid YAML.
  parseYamlSafe(content);
  return { content, warnings, extraSections: Object.keys(extraSections) };
}

/** Simulated preview payload: never claims to be a real Minecraft client render. */
export function buildTabPreview(model: TabModel) {
  return {
    header: model.headerFooter.enabled ? model.headerFooter.header : [],
    footer: model.headerFooter.enabled ? model.headerFooter.footer : [],
    tablistNameFormat: model.tablistNameFormatting.enabled ? model.tablistNameFormatting.format : ['%player%'],
    teamFormat: model.scoreboardTeams.enabled ? model.scoreboardTeams.format : '%player%',
    objective: model.playerlistObjective.enabled
      ? { title: model.playerlistObjective.title, value: model.playerlistObjective.value }
      : null,
    belowName: model.belownameObjective.enabled
      ? { title: model.belownameObjective.title, value: model.belownameObjective.value }
      : null,
    bossbar: model.bossbar.enabled ? model.bossbar : null,
    simulated: true,
    note: 'Visual simulation only. It approximates TAB rendering and is not a running Minecraft client.',
  };
}
