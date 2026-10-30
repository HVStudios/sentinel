import { describe, expect, it } from 'vitest';
import { Store } from '../src/store.ts';
import { buildSnapshot, SNAPSHOT_FORMAT } from '../src/snapshot.ts';

describe('snapshot export', () => {
  it('contains nodes, edges, provenance and source status with a timestamp', () => {
    const store = new Store(':memory:', () => '2026-10-30T00:00:00.000Z');
    store.registerSource({ id: 's', name: 'S', homepage: 'h', description: 'd' });
    store.recordSourceRun('s', { status: 'ok', count: 1, durationMs: 5 });
    store.writeBatch({
      nodes: [{ id: 'quake:1', type: 'natural_event', title: 'Q', occurredAt: '2026-10-29T00:00:00Z', lat: 1, lon: 2, geoBasis: 'coordinates' }, { id: 'vendor:a', type: 'vendor', title: 'A' }],
      edges: [{ src: 'quake:1', dst: 'vendor:a', rel: 'mentions', basis: 'inferred', confidence: 0.6, rationale: 'r', sourceId: 's' }],
      provenance: [{ nodeId: 'quake:1', sourceId: 's', sourceUrl: 'https://example.org' }],
    });
    const snap = buildSnapshot(store, () => new Date('2026-10-30T01:00:00Z'));
    expect(snap).toMatchObject({ format: SNAPSHOT_FORMAT, generatedAt: '2026-10-30T01:00:00.000Z' });
    expect(snap.nodes.map((n) => n.id)).toEqual(['quake:1', 'vendor:a']);
    expect(snap.edges[0]).toMatchObject({ basis: 'inferred', confidence: 0.6, rationale: 'r' });
    expect(snap.provenance).toEqual([{ nodeId: 'quake:1', sourceId: 's', sourceUrl: 'https://example.org', fetchedAt: '2026-10-30T00:00:00.000Z' }]);
    expect(snap.sources[0]).toMatchObject({ id: 's', lastStatus: 'ok' });
    expect(JSON.parse(JSON.stringify(snap))).toEqual(snap);
  });
});
