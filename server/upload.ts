import crypto from 'node:crypto';
import path from 'node:path';
import multer from 'multer';
import { config, ensureDataDirs, storagePaths } from './config.js';
import { badRequest } from './util.js';

ensureDataDirs();

const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    cb(null, storagePaths.tmp);
  },
  filename(_req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `upload-${crypto.randomUUID()}${ext}`);
  },
});

/** Size-limited disk upload; nothing is ever executed or trusted. */
export const upload = multer({
  storage,
  limits: { fileSize: config.maxUploadBytes, files: 1, fields: 30, parts: 35 },
  fileFilter(_req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== '.jar' && ext !== '.zip' && ext !== '.yml' && ext !== '.yaml' && ext !== '.json' && ext !== '.toml' && ext !== '.txt' && ext !== '.conf' && ext !== '.properties') {
      cb(badRequest('Unsupported file type. Allowed: .jar, .zip and text configuration files.'));
      return;
    }
    cb(null, true);
  },
});
