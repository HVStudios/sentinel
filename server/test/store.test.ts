import { beforeEach, describe, expect, it } from 'vitest';
import { Store } from '../src/store.ts';
import type { Batch } from '../src/types.ts';

const src = { id: 'test', name: 'Test source', homepage: 'https://example.org', description: 'fixture' };

const batch = (): Batch => ({
  nodes: [
    {
      id: 'cve:CVE-2024-0001',
      type: 'vulnerability',
      title: 'CVE-2024-0001',
      summary: 'Example vuln',
      occurredAt: '2024-05-02T00:00:00.000Z',
      attrs: { kev: true },
    },
    { id: 'vendor:acme', type: 'vendor', title: 'Acme' },
    {
      id: 'quake:1',
      type: 'natural_event',
      title: 'M 6.1 - somewhere',
      occurredAt: '2024-05-01T12:00:00.000Z',
      lat: 10,
      lon: 20,
      geoBasis: 'coordinates',
    },
    {
      id: 'news:a',
      type: 'article',
      title: 'Headline about Acme',
      occurredAt: '2024-05-03T00:00:00.000Z',
      country: 'Germany',
      geoBasis: 'publisher_country',
    },
  ],
  edges: [{ src: 'cve:CVE-2024-0001', dst: 'vendor:acme', rel: 'affects', basis: 'reported', confidence: 1, sourceId: 'test' }],
  provenance: [
    { nodeId: 'cve:CVE-2024-0001', sourceId: 'test', sourceUrl: 'https://example.org/cve' },
    { nodeId: 'vendor:acme', sourceId: 'test' },
  ],
});

describe('Store', () => {
  let store: Store;
  beforeEach(() => {
    store = new Store(':memory:', () => '2024-06-01T00:00:00.000Z');
    store.registerSource(src);
  });

  it('is idempotent when writing the same batch twice', () => {
    store.writeBatch(batch());
    const first = store.counts();
    store.writeBatch(batch());
    expect(store.counts()).toEqual(first);
    expect(first).toMatchObject({ vulnerability: 1, vendor: 1, natural_event: 1, article: 1, edges: 1 });
  });

  it('merges updates without clobbering existing values with nulls', () => {
    store.writeBatch(batch());
    store.writeBatch({
      nodes: [{ id: 'cve:CVE-2024-0001', type: 'vulnerability', title: 'CVE-2024-0001', severity: 0.98, attrs: { cvss: 9.8 } }],
      edges: [],
      provenance: [],
    });
    const node = store.getNode('cve:CVE-2024-0001')!;
    expect(node.summary).toBe('Example vuln');
    expect(node.severity).toBe(0.98);
    expect(node.attrs).toEqual({ kev: true, cvss: 9.8 });
  });

  it('never downgrades a reported edge to inferred', () => {
    store.writeBatch(batch());
    store.writeBatch({
      nodes: [],
      edges: [{ src: 'cve:CVE-2024-0001', dst: 'vendor:acme', rel: 'affects', basis: 'inferred', confidence: 0.5, sourceId: 'test' }],
      provenance: [],
    });
    const [edge] = store.edgesOf('vendor:acme');
    expect(edge).toMatchObject({ basis: 'reported', confidence: 1 });
  });

  it('rolls back a failing batch atomically', () => {
    const bad = batch();
    // geo_basis has a check constraint; an invalid value must abort the whole batch.
    (bad.nodes[3] as { geoBasis: string }).geoBasis = 'guessed';
    expect(() => store.writeBatch(bad)).toThrow();
    expect(store.counts()).toEqual({ edges: 0 });
  });

  it('returns provenance with source metadata', () => {
    store.writeBatch(batch());
    const prov = store.provenanceFor('cve:CVE-2024-0001');
    expect(prov).toEqual([
      expect.objectContaining({ id: 'test', name: 'Test source', sourceUrl: 'https://example.org/cve', fetchedAt: '2024-06-01T00:00:00.000Z' }),
    ]);
  });

  it('pages the feed newest-first and filters by type, time and text', () => {
    store.writeBatch(batch());
    const page1 = store.feed({ limit: 2 });
    expect(page1.items.map((i) => i.id)).toEqual(['news:a', 'cve:CVE-2024-0001']);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = store.feed({ limit: 2, before: page1.nextCursor! });
    expect(page2.items.map((i) => i.id)).toEqual(['quake:1']);
    expect(page2.nextCursor).toBeNull();

    expect(store.feed({ types: ['natural_event'] }).items).toHaveLength(1);
    expect(store.feed({ from: '2024-05-02T00:00:00.000Z' }).items).toHaveLength(2);
    expect(store.feed({ q: 'acme' }).items.map((i) => i.id)).toEqual(['news:a']);
    expect(store.feed({ q: '100%' }).items).toHaveLength(0);
    // Reference nodes such as vendors never appear in the feed.
    expect(store.feed({ types: ['vendor'] }).items.every((i) => i.type !== 'vendor')).toBe(true);
  });

  it('separates coordinate points from publisher-country aggregates on the map', () => {
    store.writeBatch(batch());
    const map = store.mapData({});
    expect(map.points.map((p) => p.id)).toEqual(['quake:1']);
    expect(map.countries).toEqual([{ country: 'Germany', count: 1 }]);
  });

  it('buckets the timeline per type', () => {
    store.writeBatch(batch());
    const tl = store.timeline({ from: '2024-05-01T00:00:00.000Z', to: '2024-05-04T00:00:00.000Z', buckets: 3 });
    expect(tl.series).toEqual({ natural_event: [1, 0, 0], vulnerability: [0, 1, 0], article: [0, 0, 1] });
  });

  it('builds a bounded neighbourhood graph', () => {
    store.writeBatch(batch());
    const g = store.graph('vendor:acme', 2);
    expect(g.nodes.map((x) => x.id).sort()).toEqual(['cve:CVE-2024-0001', 'vendor:acme']);
    expect(g.edges).toHaveLength(1);
    expect(store.graph('missing')).toEqual({ nodes: [], edges: [] });
    expect(store.graph('vendor:acme', 2, 1).nodes).toHaveLength(1);
  });

  it('replaces only inferred edges of a given source', () => {
    store.writeBatch(batch());
    store.replaceInferredEdges('relate', [
      { src: 'news:a', dst: 'vendor:acme', rel: 'mentions', basis: 'inferred', confidence: 0.6, sourceId: 'relate' },
    ]);
    expect(store.counts().edges).toBe(2);
    store.replaceInferredEdges('relate', []);
    expect(store.counts().edges).toBe(1);
  });

  it('records source runs', () => {
    store.recordSourceRun('test', { status: 'error', count: 0, error: 'boom', durationMs: 12 });
    expect(store.sources()[0]).toMatchObject({ lastStatus: 'error', lastError: 'boom', lastRunAt: '2024-06-01T00:00:00.000Z' });
  });
});
