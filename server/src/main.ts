import { existsSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import { buildApp } from './api.ts';
import { config } from './config.ts';
import { Store } from './store.ts';

const loopback = ['127.0.0.1', 'localhost', '::1'].includes(config.host);
const store = new Store(config.dbPath);
const app = buildApp(store, { allowIngest: loopback, logger: true });

if (existsSync(config.webDist)) {
  await app.register(fastifyStatic, { root: config.webDist });
  // Client-side routes fall back to the SPA shell; unknown API paths stay 404 JSON.
  app.setNotFoundHandler((req, reply) =>
    req.url.startsWith('/api/') ? reply.code(404).send({ error: 'not found' }) : reply.sendFile('index.html'),
  );
}

const shutdown = async () => {
  await app.close();
  store.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: config.port, host: config.host });
