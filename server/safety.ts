import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import yauzl, { type Entry, type ZipFile } from 'yauzl';
import { config } from './config.js';
import { HttpError, badRequest } from './util.js';

/** Normalises archive parser errors into safe 400 responses (never leaks internals). */
function archiveError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (/relative path|absolute path|traversal|invalid characters|unsafe/i.test(message)) {
    return badRequest('Archive path is unsafe (possible path traversal): ' + message);
  }
  return badRequest('Invalid or unreadable ZIP archive: ' + message);
}

const RESERVED_WINDOWS_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/**
 * Normalises a path taken from an untrusted archive/upload and rejects anything
 * that could escape a containment root or produce an unsafe filename.
 */
export function assertSafeRelativePath(input: string): string {
  if (typeof input !== 'string' || input.trim() === '') throw badRequest('Empty path in archive.');
  if (input.includes('\0')) throw badRequest('Null byte in path.');
  if (/[\u0000-\u001f\u007f]/.test(input)) throw badRequest('Control character in path.');
  let value = input.replace(/\\/g, '/');
  if (value.startsWith('/')) throw badRequest(`Absolute path is not allowed: ${input}`);
  if (/^[a-zA-Z]:/.test(value)) throw badRequest(`Drive-letter path is not allowed: ${input}`);
  if (value.startsWith('~')) throw badRequest(`Home-relative path is not allowed: ${input}`);
  if (value.length > 512) throw badRequest('Path too long.');
  const parts = value.split('/').filter((p) => p !== '' && p !== '.');
  if (parts.length === 0) throw badRequest('Empty path in archive.');
  for (const part of parts) {
    if (part === '..') throw badRequest(`Path traversal is not allowed: ${input}`);
    if (part.length > 255) throw badRequest('Path segment too long.');
    if (RESERVED_WINDOWS_NAMES.test(part)) throw badRequest(`Reserved filename: ${part}`);
  }
  return parts.join('/');
}

/** Resolves `relative` inside `baseDir`, throwing if the result escapes it. */
export function resolveInside(baseDir: string, relative: string): string {
  const safe = assertSafeRelativePath(relative);
  const base = path.resolve(baseDir);
  const resolved = path.resolve(base, safe);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw badRequest('Resolved path escapes the storage root.');
  }
  return resolved;
}

/** Converts a storage-relative path to an absolute path under DATA_DIR. */
export function fromStorageRoot(relative: string): string {
  return resolveInside(config.dataDir, relative);
}

export function toStorageRoot(absolute: string): string {
  const base = path.resolve(config.dataDir);
  const rel = path.relative(base, path.resolve(absolute));
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw badRequest('File is outside the storage root.');
  return rel.split(path.sep).join('/');
}

/** Produces a safe single path segment for a stored file name. */
export function safeFileName(input: string): string {
  const base = input.split(/[\\/]/).pop() || '';
  const cleaned = base
    .normalize('NFKD')
    .replace(/[^\w.\-+ ()\[\]]+/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 180);
  if (!cleaned || cleaned === '.' || cleaned === '..') return 'file';
  return cleaned;
}

export function formatForPath(filePath: string): 'yaml' | 'json' | 'toml' | 'text' {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.yml' || ext === '.yaml') return 'yaml';
  if (ext === '.json' || ext === '.mcmeta') return 'json';
  if (ext === '.toml') return 'toml';
  return 'text';
}

export const TEXT_CONFIG_EXTENSIONS = new Set([
  '.yml',
  '.yaml',
  '.json',
  '.toml',
  '.txt',
  '.conf',
  '.config',
  '.properties',
  '.mcmeta',
  '.md',
  '.xml',
  '.csv',
  '.tsv',
]);

export interface ZipEntryInfo {
  fileName: string;
  size: number;
  compressedSize: number;
  isDirectory: boolean;
}

function openZip(zipPath: string): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: true }, (err, zip) => {
      if (err || !zip) return reject(badRequest(`Invalid ZIP archive: ${err?.message ?? 'unknown error'}`));
      resolve(zip);
    });
  });
}

function entryIsSymlink(entry: Entry): boolean {
  // Unix mode is stored in the upper 16 bits of externalFileAttributes.
  const mode = (entry.externalFileAttributes >>> 16) & 0xffff;
  return (mode & 0o170000) === 0o120000;
}

/**
 * Lists and validates the entries of a ZIP archive without extracting.
 * Enforces entry count, size, symlink and traversal protections.
 */
export async function listZipEntries(
  zipPath: string,
  limits: { maxEntries?: number; maxTotalBytes?: number } = {},
): Promise<ZipEntryInfo[]> {
  const maxEntries = limits.maxEntries ?? config.maxArchiveEntries;
  const maxTotalBytes = limits.maxTotalBytes ?? config.maxExtractedBytes;
  const zip = await openZip(zipPath);
  const entries: ZipEntryInfo[] = [];
  const seen = new Set<string>();
  let total = 0;

  return new Promise((resolve, reject) => {
    const fail = (error: unknown) => {
      zip.close();
      reject(archiveError(error));
    };
    zip.on('error', fail);
    zip.on('entry', (entry: Entry) => {
      try {
        if (entries.length >= maxEntries) throw badRequest(`Archive contains more than ${maxEntries} entries.`);
        if (entryIsSymlink(entry)) throw badRequest('Archive contains a symbolic link, which is not allowed.');
        const rawName = entry.fileName;
        const isDirectory = rawName.endsWith('/');
        const name = assertSafeRelativePath(rawName.replace(/\/+$/, ''));
        if (seen.has(name)) throw badRequest(`Archive contains duplicate entry: ${name}`);
        seen.add(name);
        total += entry.uncompressedSize;
        if (total > maxTotalBytes) throw badRequest('Archive expands beyond the allowed size limit.');
        if (entry.uncompressedSize > 0 && entry.compressedSize === 0) {
          throw badRequest('Archive contains an invalid compressed entry.');
        }
        entries.push({ fileName: name, size: entry.uncompressedSize, compressedSize: entry.compressedSize, isDirectory });
        zip.readEntry();
      } catch (err) {
        fail(err);
      }
    });
    zip.on('end', () => resolve(entries));
    zip.readEntry();
  });
}

/**
 * Safely extracts text configuration files from an uploaded ZIP template.
 * Entries are processed strictly one at a time (read stream before advancing),
 * binary entries are skipped and nothing is ever executed.
 */
export async function extractTextArchive(
  zipPath: string,
  targetDir: string,
  limits: { maxEntries?: number; maxTotalBytes?: number } = {},
): Promise<{ extracted: string[]; skipped: string[]; totalBytes: number }> {
  const entries = await listZipEntries(zipPath, limits);
  const zip = await openZip(zipPath);
  const extracted: string[] = [];
  const skipped: string[] = [];
  let totalBytes = 0;

  const getBuffer = (entry: Entry): Promise<Buffer> =>
    new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error: Error | null, value?: Buffer) => {
        if (settled) return;
        settled = true;
        if (error) reject(error);
        else resolve(value ?? Buffer.alloc(0));
      };
      zip.openReadStream(entry, (err, stream) => {
        if (err || !stream) return finish(err ?? new Error('Unable to read archive entry'));
        const chunks: Buffer[] = [];
        let size = 0;
        stream.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > config.maxExtractedBytes) {
            stream.destroy();
            finish(badRequest('Archive entry expands beyond the size limit.'));
            return;
          }
          chunks.push(chunk);
        });
        stream.on('error', (streamError) => finish(streamError));
        stream.on('end', () => finish(null, Buffer.concat(chunks)));
      });
    });

  return new Promise((resolve, reject) => {
    let index = 0;
    let failed = false;
    const fail = (error: unknown) => {
      if (failed) return;
      failed = true;
      zip.close();
      reject(archiveError(error));
    };
    zip.on('error', fail);
    zip.on('end', () => {
      if (!failed) resolve({ extracted, skipped, totalBytes });
    });
    zip.on('entry', (entry: Entry) => {
      void (async () => {
        try {
          const info = entries[index++];
          if (!info) throw badRequest('Archive entry mismatch.');
          if (!entry.fileName.endsWith('/')) {
            const ext = path.extname(info.fileName).toLowerCase();
            if (!TEXT_CONFIG_EXTENSIONS.has(ext)) {
              skipped.push(info.fileName);
            } else {
              const buffer = await getBuffer(entry);
              if (totalBytes + buffer.length > config.maxExtractedBytes) {
                throw badRequest('Archive expands beyond the allowed size limit.');
              }
              const destination = resolveInside(targetDir, info.fileName);
              await fsp.mkdir(path.dirname(destination), { recursive: true });
              await fsp.writeFile(destination, buffer, { flag: 'wx' });
              extracted.push(info.fileName);
              totalBytes += buffer.length;
            }
          }
        } catch (err) {
          fail(err);
          return;
        }
        if (!failed) zip.readEntry();
      })();
    });
    zip.readEntry();
  });
}

/** Reads a single entry from a ZIP archive as a buffer (bounded). */
export async function readZipEntry(
  zipPath: string,
  matcher: (fileName: string) => boolean,
  maxBytes = 2 * 1024 * 1024,
): Promise<{ fileName: string; buffer: Buffer } | null> {
  const zip = await openZip(zipPath);
  return new Promise((resolve, reject) => {
    const fail = (error: unknown) => {
      zip.close();
      reject(archiveError(error));
    };
    zip.on('error', fail);
    zip.on('end', () => resolve(null));
    zip.on('entry', (entry: Entry) => {
      try {
        if (entry.fileName.endsWith('/') || !matcher(entry.fileName)) {
          zip.readEntry();
          return;
        }
        if (entry.uncompressedSize > maxBytes) throw badRequest('Archive entry is too large to inspect.');
        zip.openReadStream(entry, (err, stream) => {
          if (err || !stream) return fail(err ?? new Error('Unable to read archive entry'));
          const chunks: Buffer[] = [];
          stream.on('data', (chunk: Buffer) => chunks.push(chunk));
          stream.on('error', fail);
          stream.on('end', () => {
            zip.close();
            resolve({ fileName: entry.fileName, buffer: Buffer.concat(chunks) });
          });
        });
      } catch (err) {
        fail(err);
      }
    });
    zip.readEntry();
  });
}

export async function ensureEmptyDir(dir: string): Promise<void> {
  await fsp.rm(dir, { recursive: true, force: true });
  await fsp.mkdir(dir, { recursive: true });
}

export function fileExists(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}
