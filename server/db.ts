import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { DatabaseSync as DatabaseSyncInstance } from 'node:sqlite';
import { config, ensureDataDirs } from './config.js';

// Resolved at runtime so bundlers/test runners do not try to pre-resolve the
// built-in SQLite module (it is only available in Node >= 22.5).
const requireBuiltin = createRequire(import.meta.url);
const { DatabaseSync } = requireBuiltin('node:sqlite') as typeof import('node:sqlite');
type DatabaseSync = DatabaseSyncInstance;

export type Row = Record<string, any>;

let db: DatabaseSyncInstance | null = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  server_name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon TEXT,
  language TEXT NOT NULL DEFAULT 'en',
  mc_version TEXT NOT NULL,
  version_channel TEXT NOT NULL DEFAULT 'release',
  version_verified INTEGER NOT NULL DEFAULT 0,
  software TEXT NOT NULL,
  software_build TEXT,
  template_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS library_plugins (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  source_project_id TEXT,
  source_version_id TEXT,
  source_url TEXT,
  name TEXT NOT NULL,
  slug TEXT,
  description TEXT NOT NULL DEFAULT '',
  author TEXT NOT NULL DEFAULT '',
  version TEXT,
  mc_versions TEXT NOT NULL DEFAULT '[]',
  loaders TEXT NOT NULL DEFAULT '[]',
  folia_compatible INTEGER,
  categories TEXT NOT NULL DEFAULT '[]',
  file_path TEXT,
  file_name TEXT,
  file_hash TEXT,
  file_size INTEGER,
  icon_url TEXT,
  project_url TEXT,
  dependencies TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '',
  metadata TEXT NOT NULL DEFAULT '{}',
  config_template_dir TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_library_source_unique
  ON library_plugins(source, source_project_id, source_version_id)
  WHERE source_project_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS project_plugins (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  library_plugin_id TEXT,
  display_name TEXT NOT NULL,
  version TEXT,
  source TEXT NOT NULL,
  file_name TEXT NOT NULL,
  config_dir TEXT,
  status TEXT NOT NULL DEFAULT 'installed',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_plugin_name
  ON project_plugins(project_id, display_name);

CREATE TABLE IF NOT EXISTS project_configs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  plugin_id TEXT,
  path TEXT NOT NULL,
  format TEXT NOT NULL DEFAULT 'yaml',
  content TEXT NOT NULL DEFAULT '',
  origin TEXT NOT NULL DEFAULT 'user',
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_config_path
  ON project_configs(project_id, path);

CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  categories TEXT NOT NULL DEFAULT '[]',
  mc_versions TEXT NOT NULL DEFAULT '[]',
  software TEXT,
  plugins TEXT NOT NULL DEFAULT '[]',
  warnings TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '',
  builtin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  builtin INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export function getDb(): DatabaseSyncInstance {
  if (db) return db;
  ensureDataDirs();
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  db = new DatabaseSync(config.dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  db.exec('PRAGMA user_version = 1;');
  return db;
}

export function closeDb(): void {
  db?.close();
  db = null;
}

export function all<T = Row>(sql: string, params: any[] = []): T[] {
  return getDb().prepare(sql).all(...params) as T[];
}

export function get<T = Row>(sql: string, params: any[] = []): T | undefined {
  return getDb().prepare(sql).get(...params) as T | undefined;
}

export function run(sql: string, params: any[] = []): void {
  getDb().prepare(sql).run(...params);
}

export function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || value === '') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(): string {
  return crypto.randomUUID();
}

export function transaction<T>(fn: () => T): T {
  const database = getDb();
  database.exec('BEGIN');
  try {
    const result = fn();
    database.exec('COMMIT');
    return result;
  } catch (err) {
    database.exec('ROLLBACK');
    throw err;
  }
}
