import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

export const config = {
  port: Number(process.env.PORT ?? 8787),
  host: process.env.HOST ?? '127.0.0.1',
  dbPath: resolve(repoRoot, process.env.SENTINEL_DB ?? 'data/sentinel.db'),
  webDist: resolve(repoRoot, 'web/dist'),
  /** Test-only: pin the server clock (used by the end-to-end tests so time windows stay stable). */
  fakeNow: process.env.SENTINEL_FAKE_NOW ? new Date(process.env.SENTINEL_FAKE_NOW) : null,
  refreshMinutes: Math.max(0, Number(process.env.SENTINEL_REFRESH_MINUTES ?? 0) || 0),
};
