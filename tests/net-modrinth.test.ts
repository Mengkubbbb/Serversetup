import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:dns/promises', () => ({
  default: { lookup: vi.fn(async () => [{ address: '203.0.113.9', family: 4 }]) },
}));

import { assertSafeUrl, fetchJson, isPrivateIp, MODRINTH_CDN_HOSTS } from '../server/net.js';
import { downloadToFile } from '../server/download.js';
import { getModrinthVersions, mapSearchHit, searchModrinth, selectPrimaryFile } from '../server/modrinth.js';
import type { ModrinthVersion } from '../server/modrinth.js';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const jsonResponse = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => {
  fetchMock.mockReset();
});

describe('network safety', () => {
  it('identifies private and reserved addresses', () => {
    for (const ip of ['127.0.0.1', '10.0.0.5', '172.16.4.1', '192.168.0.10', '169.254.169.254', '100.64.0.1', '224.0.0.1', '0.0.0.0', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1']) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
    for (const ip of ['8.8.8.8', '1.1.1.1', '203.0.113.9', '2606:4700:4700::1111']) {
      expect(isPrivateIp(ip), ip).toBe(false);
    }
  });

  it('rejects untrusted hosts, protocols, credentials and private addresses', async () => {
    await expect(assertSafeUrl('file:///etc/passwd', { allowedHosts: MODRINTH_CDN_HOSTS })).rejects.toThrow(/HTTPS/);
    await expect(assertSafeUrl('https://evil.example/x.jar', { allowedHosts: MODRINTH_CDN_HOSTS })).rejects.toThrow(/allowlist/);
    await expect(assertSafeUrl('https://cdn.modrinth.com.evil.example/x', { allowedHosts: MODRINTH_CDN_HOSTS })).rejects.toThrow(/allowlist/);
    await expect(assertSafeUrl('https://user:pass@cdn.modrinth.com/x', { allowedHosts: MODRINTH_CDN_HOSTS })).rejects.toThrow(/credentials/);
    await expect(assertSafeUrl('http://127.0.0.1/x', { allowedHosts: ['127.0.0.1'], allowHttp: true })).rejects.toThrow(/private/);
    await expect(assertSafeUrl('https://cdn.modrinth.com/data/x.jar', { allowedHosts: MODRINTH_CDN_HOSTS })).resolves.toBeInstanceOf(URL);
  });

  it('handles upstream failures and unsafe redirects', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNRESET'));
    await expect(
      fetchJson('https://api.modrinth.com/v2/search', { allowedHosts: ['api.modrinth.com'] }),
    ).rejects.toMatchObject({ code: 'upstream_unreachable', status: 502 });

    fetchMock.mockResolvedValue(new Response('nope', { status: 403 }));
    await expect(
      fetchJson('https://api.modrinth.com/v2/search', { allowedHosts: ['api.modrinth.com'] }),
    ).rejects.toMatchObject({ code: 'upstream_error' });

    fetchMock.mockClear();
    fetchMock.mockResolvedValue(new Response(null, { status: 302, headers: { location: 'https://evil.example/steal' } }));
    await expect(
      fetchJson('https://api.modrinth.com/v2/search', { allowedHosts: ['api.modrinth.com'] }),
    ).rejects.toMatchObject({ code: 'bad_request' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('Modrinth integration', () => {
  it('parses search results and requests plugin-only facets', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        hits: [
          {
            project_id: 'hXiIvTyT',
            slug: 'essentialsx',
            title: 'EssentialsX',
            description: 'The essential plugin suite',
            author: 'mdcfe',
            categories: ['paper', 'economy'],
            display_categories: ['Economy'],
            versions: ['1.21.4'],
            icon_url: 'https://cdn.modrinth.com/icon.png',
            project_type: 'mod',
            all_project_types: ['plugin'],
            downloads: 100,
            follows: 10,
            date_modified: '2026-01-01T00:00:00Z',
          },
        ],
        offset: 0,
        limit: 20,
        total_hits: 1,
      }),
    );

    const result = await searchModrinth({ query: 'essentials', mcVersion: '1.21.4', limit: 20 });
    expect(result.hits).toHaveLength(1);
    const requestUrl = decodeURIComponent(String(fetchMock.mock.calls[0][0]));
    expect(requestUrl).toContain('project_type:plugin');
    expect(requestUrl).toContain('versions:1.21.4');

    const mapped = mapSearchHit(result.hits[0]);
    expect(mapped).toMatchObject({ id: 'hXiIvTyT', name: 'EssentialsX', slug: 'essentialsx' });
  });

  it('requests versions with loader filters and selects the jar file', async () => {
    const version: ModrinthVersion = {
      id: 'ver1',
      project_id: 'hXiIvTyT',
      name: 'Release',
      version_number: '2.22.0',
      version_type: 'release',
      game_versions: ['1.21.4'],
      loaders: ['paper'],
      date_published: '2026-01-01T00:00:00Z',
      files: [
        { hashes: { sha512: 'abc' }, url: 'https://cdn.modrinth.com/x-sources.jar', filename: 'sources.jar', primary: false, size: 1 },
        { hashes: { sha512: 'def' }, url: 'https://cdn.modrinth.com/x.jar', filename: 'Plugin-2.22.0.jar', primary: true, size: 1234 },
      ],
      dependencies: [{ version_id: null, project_id: 'vault', file_name: null, dependency_type: 'required' }],
    };
    fetchMock.mockResolvedValue(jsonResponse([version]));

    const versions = await getModrinthVersions('hXiIvTyT', { loaders: ['paper'], mcVersion: '1.21.4' });
    expect(versions).toHaveLength(1);
    const requestUrl = decodeURIComponent(String(fetchMock.mock.calls[0][0]));
    expect(requestUrl).toContain('loaders=["paper"]');
    expect(requestUrl).toContain('game_versions=["1.21.4"]');

    const file = selectPrimaryFile(versions[0]);
    expect(file?.filename).toBe('Plugin-2.22.0.jar');
    expect(file?.hashes.sha512).toBe('def');
  });

  it('rejects malformed project identifiers before calling upstream', async () => {
    await expect(getModrinthVersions('../etc/passwd')).rejects.toThrow(/Invalid Modrinth project identifier/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('verified downloads', () => {
  const bytes = Buffer.from('fake-plugin-jar-bytes');
  const sha512 = crypto.createHash('sha512').update(bytes).digest('hex');
  const destDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssm-download-'));

  afterEach(() => {
    for (const file of fs.readdirSync(destDir)) fs.rmSync(path.join(destDir, file), { force: true });
  });

  it('writes the file only when the SHA-512 matches', async () => {
    fetchMock.mockImplementation(
      async () => new Response(bytes, { status: 200, headers: { 'content-length': String(bytes.length) } }),
    );
    const dest = path.join(destDir, 'plugin.jar');
    await expect(
      downloadToFile('https://cdn.modrinth.com/data/x/plugin.jar', dest, { expectedSha512: 'deadbeef' }),
    ).rejects.toMatchObject({ code: 'hash_mismatch' });
    expect(fs.existsSync(dest)).toBe(false);

    const result = await downloadToFile('https://cdn.modrinth.com/data/x/plugin.jar', dest, { expectedSha512: sha512 });
    expect(result.bytes).toBe(bytes.length);
    expect(fs.readFileSync(dest).toString()).toBe(bytes.toString());
  });

  it('rejects downloads that exceed the declared size limit', async () => {
    fetchMock.mockImplementation(
      async () => new Response(bytes, { status: 200, headers: { 'content-length': String(bytes.length) } }),
    );
    await expect(
      downloadToFile('https://cdn.modrinth.com/data/x/plugin.jar', path.join(destDir, 'big.jar'), { maxBytes: 4 }),
    ).rejects.toMatchObject({ status: 413 });
  });
});
