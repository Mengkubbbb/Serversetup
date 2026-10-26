import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Integration tests create real ZIP archives, SQLite databases and files.
    testTimeout: 15000,
    hookTimeout: 20000,
  },
});
