import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/api.ts';
import { Store } from '../src/store.ts';

const seed = (store: Store) => {
  store.registerSource({ id: 'test', name: 'Test', homepage: 'https://example.org', description: 'd' });
  store.writeBatch({
    nodes: [
      { id: 'cve:CVE-2026-0001', type: 'vulnerability', title: 'Example RCE', occurredAt: '2026-10-29T00:00:00.000Z', attrs: { kev: {} } },
      { id: 'product:acme/router', type: 'product', title: 'Acme Router' },
      { id: 'vendor:acme', type: 'vendor', title: 'Acme' },
      { id: 'quake:1', type: 'natural_event', title: 'M 6.0', occurredAt: '2026-10-28T00:00:00.000Z', lat: 1, lon: 2, geoBasis: 'coordinates' },
      { id: 'news:1', type: 'article', title: 'Acme router flaw', occurredAt: '2026-10-30T00:00:00.000Z', country: 'Sweden', geoBasis: 'publisher_country' },
    ],
    edges: [
      { src: 'cve:CVE-2026-0001', dst: 'product:acme/router', rel: 'affects', basis: 'reported', confidence: 1, sourceId: 'test' },
      { src: 'product:acme/router', dst: 'vendor:acme', rel: 'made_by', basis: 'reported', confidence: 1, sourceId: 'test' },
      { src: 'news:1', dst: 'vendor:acme', rel: 'mentions', basis: 'inferred', confidence: 0.6, rationale: 'name match', sourceId: 'test' },
    ],
    provenance: [{ nodeId: 'cve:CVE-2026-0001', sourceId: 'test', sourceUrl: 'https://example.org/1' }],
  });
};

describe('HTTP API', () => {
  let store: Store;
  let app: FastifyInstance;

  beforeEach(() => {
    store = new Store();
    seed(store);
    app = buildApp(store, { now: () => new Date('2026-10-31T00:00:00.000Z') });
  });
  afterEach(async () => {
    await app.close();
  });

  const get = async (url: string) => {
    const res = await app.inject({ method: 'GET', url });
    return { status: res.statusCode, body: res.json() };
  };

  it('reports health and counts', async () => {
    const { status, body } = await get('/api/health');
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, counts: { vulnerability: 1, edges: 3 } });
  });

  it('serves the feed with filters and validation', async () => {
    expect((await get('/api/feed')).body.items.map((i: { id: string }) => i.id)).toEqual(['news:1', 'cve:CVE-2026-0001', 'quake:1']);
    expect((await get('/api/feed?types=natural_event,article')).body.items).toHaveLength(2);
    expect((await get('/api/feed?q=router')).body.items).toHaveLength(1);
    expect((await get('/api/feed?from=2026-10-29T00:00:00Z')).body.items).toHaveLength(2);
    expect((await get('/api/feed?types=vendor')).status).toBe(400);
    expect((await get('/api/feed?limit=0')).status).toBe(400);
    expect((await get('/api/feed?from=yesterday')).status).toBe(400);
    expect((await get('/api/feed?drop=table')).status).toBe(400);
  });

  it('serves map points and publisher-country aggregates separately', async () => {
    const { body } = await get('/api/map');
    expect(body.points.map((p: { id: string }) => p.id)).toEqual(['quake:1']);
    expect(body.countries).toEqual([{ country: 'Sweden', count: 1 }]);
  });

  it('serves a timeline with a default 30-day window', async () => {
    const { body } = await get('/api/timeline?buckets=30');
    expect(body.to).toBe('2026-10-31T00:00:00.000Z');
    expect(body.series.article.reduce((a: number, b: number) => a + b, 0)).toBe(1);
    expect((await get('/api/timeline?from=2026-10-31T00:00:00Z&to=2026-10-01T00:00:00Z')).status).toBe(400);
  });

  it('returns node detail with provenance and labelled edges', async () => {
    const { status, body } = await get('/api/nodes/vendor:acme');
    expect(status).toBe(200);
    expect(body.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rel: 'made_by', basis: 'reported', direction: 'in', other: expect.objectContaining({ id: 'product:acme/router' }) }),
        expect.objectContaining({ rel: 'mentions', basis: 'inferred', confidence: 0.6, rationale: 'name match' }),
      ]),
    );
    expect((await get('/api/nodes/cve:CVE-2026-0001')).body.provenance[0]).toMatchObject({ name: 'Test', sourceUrl: 'https://example.org/1' });
    expect((await get('/api/nodes/nope')).status).toBe(404);
  });

  it('returns graph neighbourhoods by depth', async () => {
    expect((await get('/api/graph/cve:CVE-2026-0001')).body.nodes).toHaveLength(2);
    expect((await get('/api/graph/cve:CVE-2026-0001?depth=2')).body.nodes).toHaveLength(3);
    expect((await get('/api/graph/cve:CVE-2026-0001?depth=3')).status).toBe(400);
    expect((await get('/api/graph/missing')).status).toBe(404);
  });

  it('lists sources', async () => {
    const { body } = await get('/api/sources');
    expect(body.sources[0]).toMatchObject({ id: 'test', name: 'Test' });
    expect(body.ingest.running).toBe(false);
  });

  it('does not expose ingest unless enabled', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/ingest' })).statusCode).toBe(404);
  });

  it('runs ingest single-flight when enabled', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const ingestApp = buildApp(store, { allowIngest: true, runIngest: async () => { await gate; return { results: [] }; } });
    expect((await ingestApp.inject({ method: 'POST', url: '/api/ingest' })).statusCode).toBe(202);
    expect((await ingestApp.inject({ method: 'POST', url: '/api/ingest' })).statusCode).toBe(409);
    release();
    await new Promise((r) => setTimeout(r, 0));
    const status = (await ingestApp.inject({ method: 'GET', url: '/api/sources' })).json();
    expect(status.ingest.running).toBe(false);
    expect(status.ingest.last.finishedAt).toBeTruthy();
    await ingestApp.close();
  });
});
