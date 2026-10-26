import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  binaryParser,
  bootServer,
  createPluginJar,
  initTestEnv,
  pluginYml,
  readZipEntries,
  teardown,
  writeZip,
} from './helpers.js';

const dataDir = initTestEnv('export');
let app: Awaited<ReturnType<typeof bootServer>>['app'];
let db: Awaited<ReturnType<typeof bootServer>>['db'];
let projectId = '';
let libraryId = '';

beforeAll(async () => {
  const booted = await bootServer();
  app = booted.app;
  db = booted.db;

  const fixtures = path.join(dataDir, 'fixtures');
  fs.mkdirSync(fixtures, { recursive: true });
  const jar = path.join(fixtures, 'EssentialsX-1.0.0.jar');
  createPluginJar(jar, pluginYml({ name: 'EssentialsX', version: '1.0.0', apiVersion: '1.21', folia: true }));

  const template = path.join(fixtures, 'template.zip');
  writeZip(template, [
    { name: 'Essentials/config.yml', data: 'enabled: true\n' },
    { name: 'Essentials/optional-kit.yml', data: 'kits: {}\n' },
  ]);

  const upload = await request(app)
    .post('/api/plugins/library/upload')
    .field('kind', 'jar')
    .field('categories', JSON.stringify(['Essentials']))
    .field('mcVersions', '1.21.4')
    .field('loaders', 'paper')
    .attach('file', jar)
    .expect(201);
  libraryId = upload.body.plugin.id;

  await request(app)
    .post('/api/plugins/library/upload')
    .field('kind', 'template')
    .field('linkToPluginId', libraryId)
    .attach('file', template)
    .expect(201);

  const project = await request(app)
    .post('/api/projects')
    .send({ name: 'Export Project', serverName: 'ExportServer', language: 'en', mcVersion: '1.21.4', software: 'paper' })
    .expect(201);
  projectId = project.body.project.id;

  await request(app).post(`/api/projects/${projectId}/plugins`).send({ libraryPluginId: libraryId }).expect(201);
  await request(app)
    .post(`/api/projects/${projectId}/configs`)
    .send({ path: 'Essentials/custom.yml', content: 'custom: true\n' })
    .expect(201);
});

afterAll(async () => {
  await teardown(dataDir, db);
});

describe('ZIP export', () => {
  it('previews the export with only plugins/ entries and no internal metadata', async () => {
    const res = await request(app).get(`/api/projects/${projectId}/export/preview`).expect(200);
    const preview = res.body.preview;
    expect(preview.fileName).toBe('ExportServer-Setup.zip');
    expect(preview.errors).toEqual([]);
    expect(preview.entries.map((entry: any) => entry.path)).toEqual(
      expect.arrayContaining([
        'plugins/EssentialsX-1.0.0.jar',
        'plugins/Essentials/config.yml',
        'plugins/Essentials/optional-kit.yml',
        'plugins/Essentials/custom.yml',
      ]),
    );
    for (const entry of preview.entries) expect(entry.path.startsWith('plugins/')).toBe(true);
    expect(preview.totalBytes).toBeGreaterThan(0);
  });

  it('produces a valid archive that contains only the plugins directory', async () => {
    const res = await request(app).get(`/api/projects/${projectId}/export`).buffer(true).parse(binaryParser as any).expect(200);
    expect(res.headers['content-type']).toContain('application/zip');
    expect(res.headers['content-disposition']).toContain('ExportServer-Setup.zip');

    const zipPath = path.join(dataDir, 'download.zip');
    fs.writeFileSync(zipPath, res.body);
    const entries = await readZipEntries(zipPath);
    const names = entries.map((entry) => entry.name);

    expect(names).toContain('plugins/EssentialsX-1.0.0.jar');
    expect(names).toContain('plugins/Essentials/config.yml');
    expect(names).toContain('plugins/Essentials/custom.yml');
    expect(names).toContain('plugins/Essentials/optional-kit.yml');

    for (const name of names) {
      expect(name === 'plugins/' || name.startsWith('plugins/')).toBe(true);
      expect(name).not.toContain('app.db');
      expect(name).not.toContain('.env');
      expect(name).not.toContain('server.properties');
      expect(name).not.toContain('world');
    }
    const jarEntry = entries.find((entry) => entry.name.endsWith('.jar'));
    expect(jarEntry && jarEntry.size).toBeGreaterThan(0);
  });

  it('can exclude template-origin configuration files', async () => {
    const preview = await request(app)
      .get(`/api/projects/${projectId}/export/preview?includeTemplateConfigs=false`)
      .expect(200);
    const paths = preview.body.preview.entries.map((entry: any) => entry.path);
    expect(paths).toContain('plugins/Essentials/custom.yml');
    expect(paths).toContain('plugins/EssentialsX-1.0.0.jar');
    expect(paths).not.toContain('plugins/Essentials/config.yml');
    expect(paths).not.toContain('plugins/Essentials/optional-kit.yml');

    const res = await request(app)
      .get(`/api/projects/${projectId}/export?includeTemplateConfigs=false`)
      .buffer(true)
      .parse(binaryParser as any)
      .expect(200);
    const zipPath = path.join(dataDir, 'download-notemplate.zip');
    fs.writeFileSync(zipPath, res.body);
    const names = (await readZipEntries(zipPath)).map((entry) => entry.name);
    expect(names).not.toContain('plugins/Essentials/config.yml');
    expect(names).toContain('plugins/Essentials/custom.yml');
  });

  it('detects file collisions instead of overwriting', async () => {
    const collision = await request(app)
      .post(`/api/projects/${projectId}/configs`)
      .send({ path: 'EssentialsX-1.0.0.jar', content: 'this would collide with the plugin jar' })
      .expect(201);

    const res = await request(app).get(`/api/projects/${projectId}/export`).expect(409);
    expect(res.body.error.message).toContain('Export validation failed');
    expect(JSON.stringify(res.body.error.details.errors)).toContain('Path collision');

    await request(app).delete(`/api/projects/${projectId}/configs/${collision.body.config.id}`).expect(204);
  });

  it('fails clearly when a selected plugin file is missing', async () => {
    const uploadedRoot = path.join(dataDir, 'plugins', 'uploaded', libraryId);
    const jarName = fs.readdirSync(uploadedRoot)[0];
    const jarPath = path.join(uploadedRoot, jarName);
    fs.renameSync(jarPath, `${jarPath}.bak`);

    const res = await request(app).get(`/api/projects/${projectId}/export`).expect(409);
    expect(JSON.stringify(res.body.error.details.errors)).toContain('missing');

    fs.renameSync(`${jarPath}.bak`, jarPath);
    await request(app).get(`/api/projects/${projectId}/export/preview`).expect(200).expect((response) => {
      expect(response.body.preview.errors).toEqual([]);
    });
  });
});
