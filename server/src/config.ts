import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

export const config = {
  port: Number(process.env.PORT ?? 8787),
  host: process.env.HOST ?? '127.0.0.1',
  dbPath: resolve(repoRoot, process.env.SENTINEL_DB ?? 'data/sentinel.db'),
  webDist: resolve(repoRoot, 'web/dist'),
};
