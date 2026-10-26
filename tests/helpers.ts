import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import yauzl from 'yauzl';

/** Creates an isolated DATA_DIR and sets test env before server modules load. */
export function initTestEnv(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ssm-${name}-`));
  process.env.DATA_DIR = dir;
  process.env.NODE_ENV = 'test';
  process.env.MODRINTH_USER_AGENT = 'server-setup-maker-test/1.0 (test)';
  return dir;
}

export async function bootServer() {
  const { createApp } = await import('../server/app.js');
  const db = await import('../server/db.js');
  const { seedTemplates } = await import('../server/templateSeed.js');
  db.getDb();
  seedTemplates();
  const app = createApp();
  return { app, db };
}

export async function teardown(dir: string, db?: { closeDb: () => void }) {
  db?.closeDb();
  fs.rmSync(dir, { recursive: true, force: true });
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipFixtureEntry {
  name: string;
  data: Buffer | string;
}

/**
 * Writes a stored (uncompressed) ZIP with exact entry names. Using a raw writer
 * lets tests include hostile names like "../evil.txt" that archivers normalise.
 */
export function writeZip(filePath: string, entries: ZipFixtureEntry[]): void {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8');
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);

    offset += 30 + name.length + data.length;
  }

  const centralBuf = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.concat([...localParts, centralBuf, end]));
}

export function createPluginJar(
  filePath: string,
  pluginYml: string,
  options: { extra?: ZipFixtureEntry[]; mainClass?: boolean } = {},
): void {
  const entries: ZipFixtureEntry[] = [{ name: 'plugin.yml', data: pluginYml }];
  if (options.mainClass !== false) {
    entries.push({ name: 'com/example/Plugin.class', data: Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0x00, 0x00]) });
  }
  entries.push(...(options.extra ?? []));
  writeZip(filePath, entries);
}

export function pluginYml(options: {
  name?: string;
  version?: string;
  apiVersion?: string;
  folia?: boolean;
  depend?: string[];
} = {}): string {
  const lines = [
    `name: ${options.name ?? 'TestPlugin'}`,
    `version: ${options.version ?? '1.0.0'}`,
    `main: com.example.Plugin`,
    `api-version: ${options.apiVersion ?? '1.21'}`,
    `description: A plugin used by automated tests`,
    `author: TestAuthor`,
  ];
  if (options.folia) lines.push('folia-supported: true');
  if (options.depend?.length) lines.push('depend:', ...options.depend.map((d) => `  - ${d}`));
  return `${lines.join('\n')}\n`;
}

export function sha256File(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

export function readZipEntries(filePath: string): Promise<{ name: string; size: number }[]> {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error('zip open failed'));
      const entries: { name: string; size: number }[] = [];
      zip.on('entry', (entry) => {
        entries.push({ name: entry.fileName, size: entry.uncompressedSize });
        zip.readEntry();
      });
      zip.on('end', () => resolve(entries));
      zip.on('error', reject);
      zip.readEntry();
    });
  });
}

export function binaryParser(res: any, callback: (err: Error | null, body: Buffer) => void): void {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
}
