import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { initTestEnv, teardown } from './helpers.js';

vi.mock('node:dns/promises', () => ({
  default: { lookup: vi.fn(async () => [{ address: '203.0.113.9', family: 4 }]) },
}));

const dataDir = initTestEnv('ai');
process.env.AI_PROVIDER = 'openai';
process.env.AI_API_KEY = 'test-key-not-real';
process.env.AI_MODEL = 'test-model';
process.env.AI_BASE_URL = 'https://api.example.test/v1';

const jarBytes = Buffer.from('pk-jar-binary-for-tests');
const sha512 = crypto.createHash('sha512').update(jarBytes).digest('hex');

const hit = {
  project_id: 'abc12345',
  slug: 'essentialsx',
  title: 'EssentialsX',
  description: 'The essential plugin suite for Paper and Spigot servers.',
  author: 'mdcfe',
  categories: ['paper', 'economy'],
  display_categories: ['Economy'],
  versions: ['1.21.4'],
  icon_url: null,
  project_type: 'mod',
  all_project_types: ['plugin'],
  downloads: 1000,
  follows: 10,
  date_modified: '2026-01-01T00:00:00Z',
};

const version = {
  id: 'ver12345',
  project_id: 'abc12345',
  name: 'Release 2.22.0',
  version_number: '2.22.0',
  version_type: 'release',
  game_versions: ['1.21.4'],
  loaders: ['paper'],
  date_published: '2026-01-01T00:00:00Z',
  files: [
    {
      hashes: { sha512 },
      url: 'https://cdn.modrinth.com/data/abc12345/versions/ver12345/EssentialsX-2.22.0.jar',
      filename: 'EssentialsX-2.22.0.jar',
      primary: true,
      size: jarBytes.length,
    },
  ],
  dependencies: [],
};

const projectPayload = {
  id: 'abc12345',
  slug: 'essentialsx',
  title: 'EssentialsX',
  description: 'The essential plugin suite for Paper and Spigot servers.',
  categories: ['paper', 'economy'],
  game_versions: ['1.21.4'],
  loaders: ['paper'],
  project_type: 'mod',
  downloads: 1000,
  icon_url: null,
  license: { id: 'gpl-3', name: 'GPL-3.0' },
};

const aiResponse = {
  summary: 'Install EssentialsX for essentials commands and economy.',
  selections: [
    { candidateId: 'modrinth:abc12345', reason: 'Provides the requested essentials commands and economy.', category: 'Essentials' },
    { candidateId: 'modrinth:doesnotexist', reason: 'Invented plugin that must be dropped.', category: 'Fake' },
  ],
  unresolved: ['Auction house plugin'],
  duplicatesAvoided: ['Second economy plugin'],
  warnings: [],
};

const fetchMock = vi.fn(async (input: unknown) => {
  const url = String(input);
  if (url.includes('/chat/completions')) {
    return new Response(
      JSON.stringify({ choices: [{ message: { content: JSON.stringify(aiResponse) } }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }
  if (/\/v2\/project\/abc12345\/version/.test(url)) {
    return new Response(JSON.stringify([version]), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (/\/v2\/project\/abc12345(\?|$)/.test(url)) {
    return new Response(JSON.stringify(projectPayload), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (/\/v2\/version\/ver12345/.test(url)) {
    return new Response(JSON.stringify(version), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (url.includes('/v2/search')) {
    return new Response(JSON.stringify({ hits: [hit], offset: 0, limit: 6, total_hits: 1 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  if (url.includes('cdn.modrinth.com')) {
    return new Response(jarBytes, { status: 200, headers: { 'content-length': String(jarBytes.length) } });
  }
  return new Response('not found', { status: 404 });
});
vi.stubGlobal('fetch', fetchMock);

let app: any;
let db: any;
let projectId = '';

beforeAll(async () => {
  const { createApp } = await import('../server/app.js');
  const dbModule = await import('../server/db.js');
  dbModule.getDb();
  (await import('../server/templateSeed.js')).seedTemplates();
  db = dbModule;
  app = createApp();
  const project = await request(app)
    .post('/api/projects')
    .send({ name: 'AI Project', serverName: 'AiServer', language: 'en', mcVersion: '1.21.4', software: 'paper' })
    .expect(201);
  projectId = project.body.project.id;
});

afterAll(async () => {
  await teardown(dataDir, db);
});

describe('AI planning', () => {
  it('reports the provider as configured', async () => {
    const status = await request(app).get('/api/ai/status').expect(200);
    expect(status.body.configured).toBe(true);
    expect(status.body.provider).toBe('openai');
  });

  it('builds a plan only from real search candidates and drops invented ids', async () => {
    const res = await request(app)
      .post('/api/ai/plan')
      .send({ projectId, prompt: 'Create a lightweight economy survival server with essentials commands' })
      .expect(200);

    const plan = res.body.plan;
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0].name).toBe('EssentialsX');
    expect(plan.items[0].candidateId).toBe('modrinth:abc12345');
    expect(plan.items[0].source).toBe('modrinth');
    expect(plan.items[0].versionId).toBe('ver12345');
    expect(plan.items[0].compatibility.level).toBe('verified');
    expect(plan.warnings.join(' ')).toContain('unknown candidate');
    expect(plan.unresolved).toContain('Auction house plugin');
    expect(plan.provider.provider).toBe('openai');
    expect(plan.candidateCount).toBeGreaterThan(0);

    // The AI request must have included the real candidate set, not a URL from the model.
    const chatCall = fetchMock.mock.calls.find(([input]) => String(input).includes('/chat/completions'));
    expect(chatCall).toBeTruthy();
  });

  it('installs approved plan items through the validated download pipeline', async () => {
    const res = await request(app)
      .post('/api/ai/install-plan')
      .send({
        projectId,
        items: [{ modrinthProjectId: 'abc12345', modrinthVersionId: 'ver12345', name: 'EssentialsX' }],
      })
      .expect(200);

    expect(res.body.results[0].status).toBe('installed');
    const project = await request(app).get(`/api/projects/${projectId}`).expect(200);
    expect(project.body.plugins).toHaveLength(1);
    expect(project.body.plugins[0].displayName).toBe('EssentialsX');
    expect(project.body.plugins[0].status).toBe('installed');

    const stored = path.join(dataDir, 'plugins', 'modrinth', 'abc12345', 'ver12345', 'EssentialsX-2.22.0.jar');
    expect(fs.existsSync(stored)).toBe(true);
    expect(fs.readFileSync(stored).length).toBe(jarBytes.length);
  });

  it('reports unavailable Modrinth plugins/versions with a clear error', async () => {
    const res = await request(app)
      .post(`/api/projects/${projectId}/plugins`)
      .send({ modrinthProjectId: 'missingproject' })
      .expect(404);
    expect(res.body.error.message).toMatch(/not found/i);
  });

  it('rejects installation requests without a resolvable plugin reference', async () => {
    const res = await request(app)
      .post('/api/ai/install-plan')
      .send({ projectId, items: [{ name: 'Made up plugin' }] })
      .expect(200);
    expect(res.body.results[0].status).toBe('failed');
  });
});
