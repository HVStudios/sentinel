import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerStaticFiles } from '../src/staticFiles.ts';

describe('static file serving', () => {
  let dir: string;
  let app: FastifyInstance;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'sentinel-static-'));
    const root = join(dir, 'dist');
    mkdirSync(join(root, 'assets'), { recursive: true });
    writeFileSync(join(root, 'index.html'), '<!doctype html><title>SENTINEL</title>');
    writeFileSync(join(root, 'assets', 'index-abc123.js'), 'console.log(1)');
    writeFileSync(join(root, 'snapshot.json'), '{}');
    writeFileSync(join(root, '.env'), 'SECRET=1');
    writeFileSync(join(dir, 'secret.txt'), 'outside the root');
    symlinkSync(join(dir, 'secret.txt'), join(root, 'link.txt'));
    app = Fastify();
    app.get('/api/health', async () => ({ ok: true }));
    await registerStaticFiles(app, root);
  });
  afterAll(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const get = (url: string, method: 'GET' | 'HEAD' | 'POST' = 'GET') => app.inject({ method, url });

  it('serves the app shell and fingerprinted assets with the right headers', async () => {
    const index = await get('/');
    expect(index.statusCode).toBe(200);
    expect(index.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(index.headers['cache-control']).toBe('no-cache');
    expect(index.body).toContain('SENTINEL');
    const asset = await get('/assets/index-abc123.js?v=1');
    expect(asset.headers['content-type']).toBe('text/javascript; charset=utf-8');
    expect(asset.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(asset.headers['x-content-type-options']).toBe('nosniff');
    expect(asset.body).toBe('console.log(1)');
    expect((await get('/snapshot.json')).headers['content-type']).toBe('application/json; charset=utf-8');
  });

  it('answers HEAD without a body and rejects other methods', async () => {
    const head = await get('/assets/index-abc123.js', 'HEAD');
    expect(head.statusCode).toBe(200);
    expect(head.headers['content-length']).toBe('14');
    expect(head.body).toBe('');
    expect((await get('/', 'POST')).statusCode).toBe(405);
  });

  it('falls back to the shell for client routes but 404s for missing files and API paths', async () => {
    expect((await get('/investigate/somewhere')).body).toContain('SENTINEL');
    expect((await get('/missing.js')).statusCode).toBe(404);
    const api = await get('/api/unknown');
    expect(api.statusCode).toBe(404);
    expect(api.json()).toEqual({ error: 'not found' });
    expect((await get('/api/health')).json()).toEqual({ ok: true });
  });

  it.each([
    '/../secret.txt',
    '/%2e%2e/secret.txt',
    '/%2e%2e%2fsecret.txt',
    '/assets/..%2f..%2fsecret.txt',
    '/..%5csecret.txt',
    '/index.html%00.js',
    '/%E0%A4%A',
    '/.env',
    '/assets/%2e%2e/.env',
    '/link.txt',
  ])('refuses %s', async (url) => {
    const res = await get(url);
    // Malformed encodings are rejected by Fastify itself (400) before reaching the handler.
    expect([400, 404]).toContain(res.statusCode);
    expect(res.body).not.toContain('outside the root');
    expect(res.body).not.toContain('SECRET');
  });
});
