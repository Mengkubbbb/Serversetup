import dns from 'node:dns/promises';
import net from 'node:net';
import { config } from './config.js';
import { HttpError, badRequest } from './util.js';

export const MODRINTH_HOSTS = ['api.modrinth.com', 'cdn.modrinth.com'];
export const MODRINTH_CDN_HOSTS = ['cdn.modrinth.com', 'github.com', 'objects.githubusercontent.com', 'raw.githubusercontent.com'];
export const PAPER_HOSTS = ['fill.papermc.io', 'api.papermc.io', 'fill-data.papermc.io', 'api.mojang.com', 'piston-meta.mojang.com'];
export const GITHUB_HOSTS = ['api.github.com', 'github.com', 'objects.githubusercontent.com'];

export function isPrivateIp(ip: string): boolean {
  const version = net.isIP(ip);
  if (version === 4) {
    const parts = ip.split('.').map(Number);
    const [a, b] = parts;
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    if (a >= 224) return true;
    return false;
  }
  if (version === 6) {
    const normalized = ip.toLowerCase();
    if (normalized === '::' || normalized === '::1') return true;
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
    if (normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) return true;
    if (normalized.startsWith('::ffff:')) {
      const mapped = normalized.slice('::ffff:'.length);
      return net.isIP(mapped) === 4 ? isPrivateIp(mapped) : true;
    }
    if (normalized.startsWith('2001:db8')) return true;
    return false;
  }
  return true;
}

export interface SafeUrlOptions {
  allowedHosts: string[];
  allowHttp?: boolean;
}

/** Validates scheme, host allowlist and resolved addresses (SSRF guard). */
export async function assertSafeUrl(rawUrl: string, options: SafeUrlOptions): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw badRequest('Malformed URL.');
  }
  if (!options.allowHttp && url.protocol !== 'https:') throw badRequest(`Only HTTPS URLs are allowed (${url.protocol}).`);
  if (options.allowHttp && url.protocol !== 'https:' && url.protocol !== 'http:') throw badRequest('Invalid URL protocol.');
  if (url.username || url.password) throw badRequest('URLs containing credentials are not allowed.');
  const hostname = url.hostname.toLowerCase();
  const allowed = options.allowedHosts.map((h) => h.toLowerCase());
  if (!allowed.includes(hostname)) throw badRequest(`Host "${hostname}" is not in the trusted download allowlist.`);
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) throw badRequest('URL resolves to a private network address.');
    return url;
  }
  let addresses: { address: string }[];
  try {
    addresses = await dns.lookup(hostname, { all: true });
  } catch {
    throw new HttpError(502, 'dns_failed', `Unable to resolve host "${hostname}".`);
  }
  if (addresses.length === 0) throw new HttpError(502, 'dns_failed', `Host "${hostname}" did not resolve.`);
  for (const addr of addresses) {
    if (isPrivateIp(addr.address)) throw badRequest('URL resolves to a private network address.');
  }
  return url;
}

export interface FetchJsonOptions {
  allowedHosts: string[];
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxBytes?: number;
}

export async function fetchJson<T = unknown>(url: string, options: FetchJsonOptions): Promise<T> {
  const res = await fetchWithPolicy(url, {
    ...options,
    accept: 'application/json',
  });
  try {
    return JSON.parse(res.body.toString('utf8')) as T;
  } catch {
    throw new HttpError(502, 'bad_upstream', 'Upstream service returned invalid JSON.');
  }
}

export interface FetchResult {
  body: Buffer;
  finalUrl: string;
  status: number;
  headers: Headers;
}

export async function fetchWithPolicy(
  url: string,
  options: FetchJsonOptions & { accept?: string; maxRedirects?: number },
): Promise<FetchResult> {
  const timeoutMs = options.timeoutMs ?? config.requestTimeoutMs;
  const maxBytes = options.maxBytes ?? 8 * 1024 * 1024;
  const maxRedirects = options.maxRedirects ?? 4;
  let current = url;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const validated = await assertSafeUrl(current, { allowedHosts: options.allowedHosts });
    let response: Response;
    try {
      response = await fetch(validated, {
        redirect: 'manual',
        headers: {
          accept: options.accept ?? 'application/json',
          'user-agent': config.modrinthUserAgent,
          ...(options.headers ?? {}),
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err: any) {
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
        throw new HttpError(504, 'upstream_timeout', 'Upstream request timed out.');
      }
      throw new HttpError(502, 'upstream_unreachable', `Unable to reach upstream service: ${err?.message ?? 'network error'}`);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new HttpError(502, 'bad_redirect', 'Upstream returned a redirect without a location.');
      if (hop === maxRedirects) throw new HttpError(502, 'too_many_redirects', 'Too many redirects from upstream service.');
      current = new URL(location, validated).toString();
      continue;
    }

    if (response.status === 429) {
      throw new HttpError(429, 'upstream_rate_limited', 'Upstream service is rate limiting requests. Try again shortly.');
    }
    if (response.status === 404) throw new HttpError(404, 'upstream_not_found', 'Upstream resource was not found.');
    if (!response.ok) {
      throw new HttpError(502, 'upstream_error', `Upstream service responded with HTTP ${response.status}.`);
    }

    const lengthHeader = response.headers.get('content-length');
    if (lengthHeader && Number(lengthHeader) > maxBytes) {
      throw new HttpError(413, 'upstream_too_large', 'Upstream file exceeds the configured size limit.');
    }

    const reader = response.body?.getReader();
    if (!reader) throw new HttpError(502, 'bad_upstream', 'Upstream response had no body.');
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new HttpError(413, 'upstream_too_large', 'Upstream file exceeds the configured size limit.');
      }
      chunks.push(value);
    }
    return {
      body: Buffer.concat(chunks.map((c) => Buffer.from(c))),
      finalUrl: validated.toString(),
      status: response.status,
      headers: response.headers,
    };
  }
  throw new HttpError(502, 'too_many_redirects', 'Too many redirects from upstream service.');
}
