import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootServer, initTestEnv, teardown } from './helpers.js';

const dataDir = initTestEnv('ai-unconfigured');
process.env.AI_PROVIDER = 'none';
process.env.AI_API_KEY = '';

let app: Awaited<ReturnType<typeof bootServer>>['app'];
let db: Awaited<ReturnType<typeof bootServer>>['db'];
let projectId = '';

beforeAll(async () => {
  const booted = await bootServer();
  app = booted.app;
  db = booted.db;
  const project = await request(app)
    .post('/api/projects')
    .send({ name: 'No AI', serverName: 'NoAiServer', language: 'en', mcVersion: '1.21.4', software: 'paper' })
    .expect(201);
  projectId = project.body.project.id;
});

afterAll(async () => {
  await teardown(dataDir, db);
});

describe('AI unavailable', () => {
  it('reports AI as unconfigured', async () => {
    const status = await request(app).get('/api/ai/status').expect(200);
    expect(status.body.configured).toBe(false);
    expect(status.body.provider).toBe('none');
    expect(status.body.note).toContain('Manual plugin selection');
  });

  it('returns a clear 503 for plan generation instead of failing elsewhere', async () => {
    const res = await request(app)
      .post('/api/ai/plan')
      .send({ projectId, prompt: 'I want an economy server with permissions and homes' })
      .expect(503);
    expect(res.body.error.code).toBe('ai_not_configured');
    expect(res.body.error.message).toContain('AI_PROVIDER');
  });

  it('keeps the manual workflow fully functional without AI', async () => {
    await request(app).get('/api/projects').expect(200);
    await request(app).get('/api/templates').expect(200);
    await request(app).get('/api/plugins/library').expect(200);
    await request(app).get(`/api/projects/${projectId}/export/preview`).expect(200);
  });
});
