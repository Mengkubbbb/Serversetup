import { config, ensureDataDirs } from '../config.js';
import { getDb } from '../db.js';
import { seedTemplates } from '../templateSeed.js';

ensureDataDirs();
getDb();
seedTemplates();
console.log(`Database initialised at ${config.dbPath}`);
console.log('Storage layout:');
console.log(`  plugins/modrinth  ${config.dataDir}/plugins/modrinth`);
console.log(`  plugins/uploaded  ${config.dataDir}/plugins/uploaded`);
console.log(`  plugins/cache     ${config.dataDir}/plugins/cache`);
console.log(`  templates         ${config.dataDir}/templates`);
console.log('Built-in server setup templates are seeded (existing templates are left untouched).');
