import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootServer, initTestEnv, teardown } from './helpers.js';

const dataDir = initTestEnv('projects');
let app: Awaited<ReturnType<typeof bootServer>>['app'];
let db: Awaited<ReturnType<typeof bootServer>>['db'];

beforeAll(async () => {
  const booted = await bootServer();
  app = booted.app;
  db = booted.db;
});

afterAll(async () => {
  await teardown(dataDir, db);
});

describe('projects', () => {
  it('creates, persists and reopens a project', async () => {
    const created = await request(app)
      .post('/api/projects')
      .send({
        name: 'Hamburger SMP',
        serverName: 'HamburgerSMP',
        language: 'th',
        mcVersion: '1.21.4',
        software: 'paper',
        description: 'Thai survival project',
      })
      .expect(201);

    expect(created.body.project.id).toBeTruthy();
    expect(created.body.project.language).toBe('th');
    expect(created.body.project.mcVersion).toBe('1.21.4');
    expect(created.body.project.versionVerified).toBe(true);

    const reopened = await request(app).get(`/api/projects/${created.body.project.id}`).expect(200);
    expect(reopened.body.project.name).toBe('Hamburger SMP');
    expect(reopened.body.project.serverName).toBe('HamburgerSMP');
    expect(reopened.body.plugins).toEqual([]);
    expect(reopened.body.configs).toEqual([]);

    const list = await request(app).get('/api/projects').expect(200);
    expect(list.body.projects.some((project: any) => project.id === created.body.project.id)).toBe(true);

    // Data must live in SQLite, not in memory.
    const persisted = await request(app).get('/api/projects').expect(200);
    expect(persisted.body.projects).toHaveLength(1);
    expect(fs.existsSync(path.join(dataDir, 'app.db'))).toBe(true);
  });

  it('treats unknown versions as unverified custom versions and rejects malformed ones', async () => {
    const custom = await request(app)
      .post('/api/projects')
      .send({ name: 'Custom', serverName: 'CustomServer', language: 'en', mcVersion: '26.99.1', software: 'leaf' })
      .expect(201);
    expect(custom.body.project.versionVerified).toBe(false);
    expect(custom.body.project.versionChannel).toBe('custom');
    expect(custom.body.versionWarning).toContain('custom version');

    await request(app)
      .post('/api/projects')
      .send({ name: 'Bad', serverName: 'Bad', language: 'en', mcVersion: 'not-a-version', software: 'paper' })
      .expect(400);
  });

  it('updates project settings, duplicates and deletes projects', async () => {
    const created = await request(app)
      .post('/api/projects')
      .send({ name: 'Original', serverName: 'Origin', language: 'en', mcVersion: '1.21.4', software: 'paper' })
      .expect(201);
    const id = created.body.project.id;

    const updated = await request(app)
      .patch(`/api/projects/${id}`)
      .send({ name: 'Renamed', language: 'th', description: 'updated' })
      .expect(200);
    expect(updated.body.project.name).toBe('Renamed');
    expect(updated.body.project.language).toBe('th');

    const duplicate = await request(app).post(`/api/projects/${id}/duplicate`).expect(201);
    expect(duplicate.body.project.id).not.toBe(id);
    expect(duplicate.body.project.name).toContain('copy');

    await request(app).delete(`/api/projects/${duplicate.body.project.id}`).expect(204);
    await request(app).get(`/api/projects/${duplicate.body.project.id}`).expect(404);
    await request(app).delete(`/api/projects/${id}`).expect(204);
  });
});

describe('configuration files', () => {
  let projectId = '';

  beforeAll(async () => {
    const created = await request(app)
      .post('/api/projects')
      .send({ name: 'Config Project', serverName: 'ConfigServer', language: 'en', mcVersion: '1.21.4', software: 'paper' })
      .expect(201);
    projectId = created.body.project.id;
  });

  it('creates, edits and validates configuration files', async () => {
    const created = await request(app)
      .post(`/api/projects/${projectId}/configs`)
      .send({ path: 'Essentials/config.yml', content: 'enabled: true\nhomes:\n  max: 5\n' })
      .expect(201);
    expect(created.body.config.format).toBe('yaml');

    const updated = await request(app)
      .put(`/api/projects/${projectId}/configs/${created.body.config.id}`)
      .send({ content: 'enabled: false\nhomes:\n  max: 10\n' })
      .expect(200);
    expect(updated.body.config.content).toContain('max: 10');

    const invalid = await request(app)
      .put(`/api/projects/${projectId}/configs/${created.body.config.id}`)
      .send({ content: 'enabled: [unclosed\n' })
      .expect(400);
    expect(invalid.body.error.message).toContain('invalid');

    const validation = await request(app)
      .post(`/api/projects/${projectId}/configs/validate`)
      .send({ content: '{"a": 1}', format: 'json' })
      .expect(200);
    expect(validation.body.valid).toBe(true);

    const list = await request(app).get(`/api/projects/${projectId}/configs`).expect(200);
    expect(list.body.configs).toHaveLength(1);
  });

  it('rejects path traversal and unsafe YAML tags', async () => {
    await request(app)
      .post(`/api/projects/${projectId}/configs`)
      .send({ path: '../escape.yml', content: 'a: 1\n' })
      .expect(400);

    await request(app)
      .post(`/api/projects/${projectId}/configs`)
      .send({ path: 'TAB/config.yml', content: 'x: !!python/object/apply:os.system ["echo hi"]\n' })
      .expect(400);
  });

  it('deletes configuration files with confirmation semantics', async () => {
    const created = await request(app)
      .post(`/api/projects/${projectId}/configs`)
      .send({ path: 'Temp/config.yml', content: 'value: 1\n' })
      .expect(201);
    await request(app).delete(`/api/projects/${projectId}/configs/${created.body.config.id}`).expect(204);
    await request(app).get(`/api/projects/${projectId}/configs/${created.body.config.id}`).expect(404);
  });
});
