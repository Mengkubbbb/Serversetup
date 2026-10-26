import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { errorHandler } from './util.js';
import { projectsRouter } from './routes/projects.js';
import { libraryRouter } from './routes/library.js';
import { metaRouter } from './routes/meta.js';
import { modrinthRouter } from './routes/modrinth.js';
import { templatesRouter } from './routes/templates.js';
import { aiRouter } from './routes/ai.js';
import { tabRouter } from './routes/tab.js';

export function createApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (req.path.startsWith('/api/')) {
      res.setHeader('Cache-Control', 'no-store');
    }
    next();
  });

  if (config.corsOrigins.length > 0) {
    app.use(
      cors({
        origin: (origin, callback) => {
          if (!origin || config.corsOrigins.includes(origin)) return callback(null, true);
          callback(new Error('Origin not allowed'));
        },
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      }),
    );
  }

  app.use(express.json({ limit: '4mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));

  app.use('/api/projects', projectsRouter);
  app.use('/api/plugins', libraryRouter);
  app.use('/api/modrinth', modrinthRouter);
  app.use('/api/templates', templatesRouter);
  app.use('/api/ai', aiRouter);
  app.use('/api/tab', tabRouter);
  app.use('/api', metaRouter);

  app.use('/api', (req, res) => {
    res.status(404).json({ error: { code: 'not_found', message: `Unknown API endpoint: ${req.method} ${req.originalUrl}` } });
  });

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const clientDir = path.resolve(__dirname, '../client');
  if (fs.existsSync(path.join(clientDir, 'index.html'))) {
    app.use(express.static(clientDir, { index: 'index.html', maxAge: '1h' }));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) return next();
      res.sendFile(path.join(clientDir, 'index.html'));
    });
  } else {
    app.get('/', (_req, res) => {
      res
        .status(200)
        .type('text/plain')
        .send('Server Setup Maker API is running. Start the Vite dev server (npm run dev) to use the UI.');
    });
  }

  app.use(errorHandler);
  return app;
}
