import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodTypeAny, type output } from 'zod';

export class HttpError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new HttpError(400, 'bad_request', message, details);
export const notFound = (message = 'Not found') => new HttpError(404, 'not_found', message);
export const conflict = (message: string, details?: unknown) =>
  new HttpError(409, 'conflict', message, details);
export const unprocessable = (message: string, details?: unknown) =>
  new HttpError(422, 'unprocessable', message, details);

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown> | unknown,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function parseWith<S extends ZodTypeAny>(schema: S, data: unknown, label = 'request'): output<S> {
  try {
    return schema.parse(data) as output<S>;
  } catch (err) {
    if (err instanceof ZodError) {
      throw badRequest(`Invalid ${label}`, err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
    }
    throw err;
  }
}

const buckets = new Map<string, { count: number; resetAt: number }>();

/** Simple in-process rate limiter for expensive endpoints (downloads, AI, export). */
export function rateLimit(name: string, limit: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${name}:${req.ip || 'local'}`;
    const now = Date.now();
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt < now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    bucket.count += 1;
    if (bucket.count > limit) {
      res.setHeader('Retry-After', Math.ceil((bucket.resetAt - now) / 1000));
      return next(new HttpError(429, 'rate_limited', 'Too many requests, please slow down.'));
    }
    next();
  };
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: { code: 'bad_request', message: 'Invalid request', details: err.issues },
    });
  }
  const e = err as any;
  if (e?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: { code: 'file_too_large', message: 'Uploaded file exceeds the size limit.' } });
  }
  if (e?.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'payload_too_large', message: 'Request body too large.' } });
  }
  console.error('[unhandled]', err);
  res.status(500).json({ error: { code: 'internal_error', message: 'Internal server error.' } });
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

export function fileExtension(fileName: string): string {
  const idx = fileName.lastIndexOf('.');
  return idx === -1 ? '' : fileName.slice(idx + 1).toLowerCase();
}
