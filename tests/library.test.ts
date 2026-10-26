import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootServer, createPluginJar, initTestEnv, pluginYml, teardown, writeZip } from './helpers.js';

const dataDir = initTestEnv('library');
let app: Awaited<ReturnType<typeof bootServer>>['app'];
let db: Awaited<ReturnType<typeof bootServer>>['db'];
let jarPath = '';
let templatePath = '';
let traversalPath = '';
let binaryOnlyPath = '';

beforeAll(async () => {
  const booted = await bootServer();
  app = booted.app;
  db = booted.db;

  const fixtureDir = path.join(dataDir, 'fixtures');
  fs.mkdirSync(fixtureDir, { recursive: true });
  jarPath = path.join(fixtureDir, 'EssentialsX-2.22.0.jar');
  createPluginJar(
    jarPath,
    pluginYml({ name: 'EssentialsX', version: '2.22.0', apiVersion: '1.21', folia: true, depend: ['Vault'] }),
  );

  templatePath = path.join(fixtureDir, 'essentials-template.zip');
  writeZip(templatePath, [
    { name: 'Essentials/config.yml', data: 'enabled: true\n' },
    { name: 'Essentials/kits.yml', data: 'kits:\n  starter:\n    delay: 0\n' },
  ]);

  traversalPath = path.join(fixtureDir, 'traversal.zip');
  writeZip(traversalPath, [
    { name: '../evil.yml', data: 'pwned: true\n' },
    { name: 'ok.yml', data: 'ok: true\n' },
  ]);

  binaryOnlyPath = path.join(fixtureDir, 'binary.zip');
  writeZip(binaryOnlyPath, [{ name: 'plugin.jar', data: Buffer.from([0x50, 0x4b, 0x03, 0x04]) }]);
});

afterAll(async () => {
  await teardown(dataDir, db);
});

describe('local plugin library', () => {
  let uploadedId = '';

  it('uploads a JAR, inspects plugin.yml and stores metadata', async () => {
    const res = await request(app)
      .post('/api/plugins/library/upload')
      .field('kind', 'jar')
      .field('categories', JSON.stringify(['Essentials', 'Administration']))
      .field('mcVersions', '1.21.4, 1.21.8')
      .field('loaders', 'paper,spigot')
      .attach('file', jarPath)
      .expect(201);

    uploadedId = res.body.plugin.id;
    expect(res.body.plugin.name).toBe('EssentialsX');
    expect(res.body.plugin.version).toBe('2.22.0');
    expect(res.body.plugin.source).toBe('local');
    expect(res.body.plugin.hasFile).toBe(true);
    expect(res.body.plugin.foliaCompatible).toBe(true);
    expect(res.body.plugin.categories).toContain('Essentials');
    expect(res.body.inspection.apiVersion).toBe('1.21');
    expect(res.body.inspection.depends).toContain('Vault');

    const stored = fs.readdirSync(path.join(dataDir, 'plugins', 'uploaded', uploadedId));
    expect(stored).toEqual(['EssentialsX-2.22.0.jar']);
  });

  it('rejects an identical file to avoid silent overwrite', async () => {
    const res = await request(app)
      .post('/api/plugins/library/upload')
      .field('kind', 'jar')
      .attach('file', jarPath)
      .expect(409);
    expect(res.body.error.message).toContain('already in the library');
    expect(res.body.error.details.existingId).toBe(uploadedId);
  });

  it('searches the local library and filters by category', async () => {
    const search = await request(app).get('/api/plugins/library?q=essentials').expect(200);
    expect(search.body.total).toBe(1);
    expect(search.body.items[0].name).toBe('EssentialsX');

    const byCategory = await request(app).get('/api/plugins/library?category=Essentials').expect(200);
    expect(byCategory.body.total).toBe(1);

    const miss = await request(app).get('/api/plugins/library?q=nonexistent-plugin').expect(200);
    expect(miss.body.total).toBe(0);
  });

  it('updates library metadata', async () => {
    const res = await request(app)
      .patch(`/api/plugins/library/${uploadedId}`)
      .send({ notes: 'Pinned for the SMP template', categories: ['Essentials'] })
      .expect(200);
    expect(res.body.plugin.notes).toBe('Pinned for the SMP template');
    expect(res.body.plugin.categories).toEqual(['Essentials']);
  });

  it('attaches an uploaded configuration template to the plugin', async () => {
    const res = await request(app)
      .post('/api/plugins/library/upload')
      .field('kind', 'template')
      .field('linkToPluginId', uploadedId)
      .attach('file', templatePath)
      .expect(201);

    expect(res.body.plugin.id).toBe(uploadedId);
    expect(res.body.files).toContain('Essentials/config.yml');

    const files = await request(app).get(`/api/plugins/library/${uploadedId}/template-files`).expect(200);
    expect(files.body.files).toHaveLength(2);

    const content = await request(app)
      .get(`/api/plugins/library/${uploadedId}/template-file?path=${encodeURIComponent('Essentials/kits.yml')}`)
      .expect(200);
    expect(content.body.content).toContain('starter');
  });

  it('rejects archive traversal and archives without configuration files', async () => {
    const traversal = await request(app)
      .post('/api/plugins/library/upload')
      .field('kind', 'template')
      .attach('file', traversalPath)
      .expect(400);
    expect(JSON.stringify(traversal.body)).toContain('traversal');

    await request(app)
      .post('/api/plugins/library/upload')
      .field('kind', 'template')
      .attach('file', binaryOnlyPath)
      .expect(400);

    // Nothing may have escaped the templates directory.
    expect(fs.existsSync(path.join(dataDir, 'evil.yml'))).toBe(false);
    expect(fs.existsSync(path.join(dataDir, '..', 'evil.yml'))).toBe(false);
  });

  it('rejects unsupported upload types', async () => {
    const txt = path.join(dataDir, 'fixtures', 'notes.exe');
    fs.writeFileSync(txt, 'MZ');
    await request(app).post('/api/plugins/library/upload').field('kind', 'jar').attach('file', txt).expect(400);
  });

  it('replaces a plugin version while keeping configuration files', async () => {
    const fixtureDir = path.join(dataDir, 'fixtures');
    const newer = path.join(fixtureDir, 'EssentialsX-2.23.0.jar');
    createPluginJar(newer, pluginYml({ name: 'EssentialsX', version: '2.23.0', apiVersion: '1.21' }));
    const other = path.join(fixtureDir, 'Vault-1.7.jar');
    createPluginJar(other, pluginYml({ name: 'Vault', version: '1.7', apiVersion: '1.21' }));

    const uploadNewer = await request(app)
      .post('/api/plugins/library/upload')
      .field('kind', 'jar')
      .field('mcVersions', '1.21.4')
      .attach('file', newer)
      .expect(201);
    const uploadOther = await request(app)
      .post('/api/plugins/library/upload')
      .field('kind', 'jar')
      .field('mcVersions', '1.21.4')
      .attach('file', other)
      .expect(201);

    const project = await request(app)
      .post('/api/projects')
      .send({ name: 'Replace Test', serverName: 'ReplaceServer', language: 'en', mcVersion: '1.21.4', software: 'paper' })
      .expect(201);
    const projectId = project.body.project.id;

    const added = await request(app).post(`/api/projects/${projectId}/plugins`).send({ libraryPluginId: uploadedId }).expect(201);
    const projectPluginId = added.body.plugin.id;
    expect(added.body.createdConfigs.length).toBeGreaterThan(0);

    const replaced = await request(app)
      .post(`/api/projects/${projectId}/plugins/${projectPluginId}/replace`)
      .send({ libraryPluginId: uploadNewer.body.plugin.id })
      .expect(200);
    expect(replaced.body.plugin.version).toBe('2.23.0');
    expect(replaced.body.plugin.fileName).toBe('EssentialsX-2.23.0.jar');

    const projectAfter = await request(app).get(`/api/projects/${projectId}`).expect(200);
    expect(projectAfter.body.configs.map((config: any) => config.path)).toContain('Essentials/config.yml');

    await request(app)
      .post(`/api/projects/${projectId}/plugins/${projectPluginId}/replace`)
      .send({ libraryPluginId: uploadNewer.body.plugin.id })
      .expect(409);

    const wrongPlugin = await request(app)
      .post(`/api/projects/${projectId}/plugins/${projectPluginId}/replace`)
      .send({ libraryPluginId: uploadOther.body.plugin.id })
      .expect(400);
    expect(wrongPlugin.body.error.message).toContain('same plugin');
  });

  it('blocks deleting a plugin referenced by a project unless forced', async () => {
    const project = await request(app)
      .post('/api/projects')
      .send({ name: 'Library Test', serverName: 'LibraryServer', language: 'en', mcVersion: '1.21.4', software: 'paper' })
      .expect(201);
    const projectId = project.body.project.id;

    const added = await request(app).post(`/api/projects/${projectId}/plugins`).send({ libraryPluginId: uploadedId }).expect(201);
    expect(added.body.plugin.displayName).toBe('EssentialsX');
    expect(added.body.createdConfigs).toContain('Essentials/config.yml');
    expect(added.body.createdConfigs).toContain('Essentials/kits.yml');
    expect(added.body.plugin.compatibility.level).toBe('verified');

    // Adding the same plugin twice is a conflict, not a silent duplicate.
    const duplicate = await request(app).post(`/api/projects/${projectId}/plugins`).send({ libraryPluginId: uploadedId }).expect(409);
    expect(duplicate.body.error.details.existingId).toBe(added.body.plugin.id);

    await request(app).delete(`/api/plugins/library/${uploadedId}`).expect(409);
    await request(app).delete(`/api/plugins/library/${uploadedId}?force=true`).expect(204);

    const projectAfter = await request(app).get(`/api/projects/${projectId}`).expect(200);
    expect(projectAfter.body.plugins[0].status).toBe('missing');
  });
});
