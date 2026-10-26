import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootServer, initTestEnv, teardown } from './helpers.js';
import {
  defaultTabModel,
  generateTabYaml,
  parseTabYaml,
  tabAdapterForVersion,
  validateTabModel,
} from '../server/tab.js';
import { parseYamlSafe } from '../server/yaml.js';

const dataDir = initTestEnv('tab');
let app: Awaited<ReturnType<typeof bootServer>>['app'];
let db: Awaited<ReturnType<typeof bootServer>>['db'];
let projectId = '';

beforeAll(async () => {
  const booted = await bootServer();
  app = booted.app;
  db = booted.db;
  const project = await request(app)
    .post('/api/projects')
    .send({ name: 'TAB Project', serverName: 'TabServer', language: 'en', mcVersion: '1.21.4', software: 'paper' })
    .expect(201);
  projectId = project.body.project.id;
});

afterAll(async () => {
  await teardown(dataDir, db);
});

describe('TAB configuration generation', () => {
  it('generates a documented TAB 5.x layout and round-trips it', () => {
    const result = generateTabYaml(defaultTabModel);
    const parsed = parseYamlSafe<Record<string, any>>(result.content);

    expect(parsed['header-footer'].enabled).toBe(true);
    expect(parsed['header-footer'].header).toEqual(defaultTabModel.headerFooter.header);
    expect(parsed['tablist-name-formatting'].format).toEqual(defaultTabModel.tablistNameFormatting.format);
    expect(parsed['playerlist-objective']['render-type']).toBe('INTEGER');
    expect(parsed['scoreboard-teams']['sorting-types']).toEqual(defaultTabModel.scoreboardTeams.sortingTypes);
    expect(parsed.bossbar.bars.default.color).toBe('BLUE');

    const reparsed = parseTabYaml(result.content);
    expect(reparsed.model.headerFooter.footer).toEqual(defaultTabModel.headerFooter.footer);
    expect(reparsed.extraSections).toEqual({});
  });

  it('preserves unsupported sections on import and export', () => {
    const imported = `
header-footer:
  enabled: true
  header:
    - "&6Imported"
  footer:
    - "&7footer"
custom-conditions:
  vip:
    - '"%luckperms_primary_group_name%" equals "vip"'
bossbar:
  enabled: true
  bars:
    default:
      style: NOTCHED_10
      color: RED
      progress: "50"
      text: "&cEvent"
    extra:
      style: PROGRESS
      color: GREEN
      progress: 10
      text: "extra"
`;
    const parsed = parseTabYaml(imported);
    expect(parsed.extraSections).toHaveProperty('custom-conditions');
    expect(parsed.model.bossbar.style).toBe('NOTCHED_10');
    expect(parsed.warnings.join(' ')).toContain('extra');

    const regenerated = generateTabYaml(parsed.model, parsed.extraSections);
    expect(regenerated.content).toContain('custom-conditions');
    expect(regenerated.content).toContain('Imported');
    const output = parseYamlSafe<Record<string, any>>(regenerated.content);
    expect(output['header-footer'].header[0]).toContain('Imported');
  });

  it('validates models and reports warnings', () => {
    const warnings = validateTabModel({
      ...defaultTabModel,
      headerFooter: { enabled: true, header: ['&6Unclosed %ping'], footer: [] },
      scoreboardTeams: { ...defaultTabModel.scoreboardTeams, format: '&fNoName' },
    });
    expect(warnings.join(' ')).toContain('Unclosed placeholder');
    expect(warnings.join(' ')).toContain('%player%');
  });

  it('only supports TAB 5.x for visual generation', () => {
    expect(tabAdapterForVersion('5.2.0').supported).toBe(true);
    expect(tabAdapterForVersion('4.2.4').supported).toBe(false);
    expect(tabAdapterForVersion(null).supported).toBe(true);
  });

  it('rejects malformed YAML imports', () => {
    expect(() => parseTabYaml('header-footer: [unclosed')).toThrow();
    expect(() => parseTabYaml('- just\n- a list\n')).toThrow(/mapping/);
  });

  it('exposes generate/validate endpoints and saves TAB/config.yml into the project', async () => {
    const generated = await request(app).post('/api/tab/generate').send({ model: defaultTabModel }).expect(200);
    expect(generated.body.content).toContain('header-footer');

    const invalid = await request(app)
      .post('/api/tab/validate')
      .send({ model: { headerFooter: { enabled: 'yes' } } })
      .expect(400);
    expect(invalid.body.error.code).toBe('bad_request');

    await request(app)
      .post(`/api/tab/projects/${projectId}/save`)
      .send({ content: generated.body.content })
      .expect(201);

    const project = await request(app).get(`/api/projects/${projectId}`).expect(200);
    expect(project.body.configs.some((config: any) => config.path === 'TAB/config.yml' && config.origin === 'generated')).toBe(true);
  });

  it('returns adapter context for a project', async () => {
    const context = await request(app).get(`/api/tab/projects/${projectId}/context`).expect(200);
    expect(context.body.tabInstalled).toBe(false);
    expect(context.body.existingConfig).toBeTruthy();
    expect(typeof context.body.adapter.message).toBe('string');
  });
});
