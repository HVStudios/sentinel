import { existsSync } from 'node:fs';
import { buildApp } from './api.ts';
import { config } from './config.ts';
import { Store } from './store.ts';
import { registerStaticFiles } from './staticFiles.ts';

const loopback = ['127.0.0.1', 'localhost', '::1'].includes(config.host);
const store = new Store(config.dbPath);
const app = buildApp(store, { allowIngest: loopback, logger: true });

if (existsSync(config.webDist)) await registerStaticFiles(app, config.webDist);

const shutdown = async () => {
  await app.close();
  store.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: config.port, host: config.host });
