import crypto from 'node:crypto';
import fs from 'node:fs';
import type { Dirent } from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { config } from './config.js';
import { assertSafeUrl, MODRINTH_CDN_HOSTS } from './net.js';
import { HttpError } from './util.js';

/** Removes orphaned .part files left behind by interrupted downloads. */
export async function cleanupPartialDownloads(root: string): Promise<number> {
  let removed = 0;
  const walk = async (dir: string): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && entry.name.endsWith('.part')) {
        await fsp.rm(full, { force: true }).catch(() => undefined);
        removed += 1;
      }
    }
  };
  await walk(root);
  return removed;
}

export interface DownloadResult {
  bytes: number;
  sha512: string;
  sha256: string;
  finalUrl: string;
}

/**
 * Streams a remote file to disk with host allowlisting, redirect validation,
 * timeouts and a hard byte ceiling. Never writes outside `destPath`.
 */
export async function downloadToFile(
  url: string,
  destPath: string,
  options: { allowedHosts?: string[]; maxBytes?: number; timeoutMs?: number; expectedSha512?: string } = {},
): Promise<DownloadResult> {
  const allowedHosts = options.allowedHosts ?? MODRINTH_CDN_HOSTS;
  const maxBytes = options.maxBytes ?? config.maxDownloadBytes;
  const timeoutMs = options.timeoutMs ?? Math.max(config.requestTimeoutMs, 60000);
  const maxRedirects = 4;
  let current = url;
  let response: Response | null = null;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const validated = await assertSafeUrl(current, { allowedHosts });
    try {
      response = await fetch(validated, {
        redirect: 'manual',
        headers: {
          'user-agent': config.modrinthUserAgent,
          accept: 'application/java-archive, application/octet-stream, */*',
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err: any) {
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
        throw new HttpError(504, 'download_timeout', 'Plugin download timed out.');
      }
      throw new HttpError(502, 'download_failed', `Plugin download failed: ${err?.message ?? 'network error'}`);
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new HttpError(502, 'bad_redirect', 'Download redirect had no location.');
      if (hop === maxRedirects) throw new HttpError(502, 'too_many_redirects', 'Too many download redirects.');
      current = new URL(location, validated).toString();
      response = null;
      continue;
    }
    break;
  }

  if (!response) throw new HttpError(502, 'download_failed', 'Plugin download failed.');
  if (!response.ok) {
    throw new HttpError(
      response.status === 404 ? 404 : 502,
      'download_failed',
      `Plugin download failed with HTTP ${response.status}.`,
    );
  }
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > maxBytes) {
    throw new HttpError(413, 'download_too_large', 'Plugin download exceeds the configured size limit.');
  }
  if (!response.body) throw new HttpError(502, 'download_failed', 'Download response had no body.');

  const sha512 = crypto.createHash('sha512');
  const sha256 = crypto.createHash('sha256');
  let bytes = 0;

  const source = Readable.fromWeb(response.body as any);
  const destDir = path.dirname(destPath);
  await fsp.mkdir(destDir, { recursive: true });
  const tempPath = path.join(destDir, `.download-${crypto.randomUUID()}.part`);

  try {
    await pipeline(
      source,
      async function* (stream: AsyncIterable<Buffer>) {
        for await (const chunk of stream) {
          bytes += chunk.length;
          if (bytes > maxBytes) throw new HttpError(413, 'download_too_large', 'Plugin download exceeds the configured size limit.');
          sha512.update(chunk);
          sha256.update(chunk);
          yield chunk;
        }
      },
      fs.createWriteStream(tempPath, { flags: 'wx' }),
    );
    if (bytes === 0) throw new HttpError(502, 'download_failed', 'Downloaded plugin file was empty.');

    const digest = sha512.digest('hex');
    if (options.expectedSha512 && options.expectedSha512.toLowerCase() !== digest) {
      throw new HttpError(502, 'hash_mismatch', 'Downloaded plugin file failed SHA-512 verification.');
    }
    await fsp.rename(tempPath, destPath);
    return { bytes, sha512: digest, sha256: sha256.digest('hex'), finalUrl: current };
  } catch (err) {
    await fsp.rm(tempPath, { force: true });
    throw err;
  }
}
