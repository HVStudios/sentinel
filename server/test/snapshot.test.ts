import { describe, expect, it } from 'vitest';
import { Store } from '../src/store.ts';
import { buildSnapshot, MAX_REFERENCES, SNAPSHOT_FORMAT } from '../src/snapshot.ts';
import { expandSnapshot, type Snapshot } from '../../web/src/staticApi.ts';

function seed() {
  const store = new Store(':memory:', () => '2026-10-30T00:00:00.000Z');
  store.registerSource({ id: 's', name: 'S', homepage: 'https://source.example/', description: 'd' });
  store.recordSourceRun('s', { status: 'ok', count: 1, durationMs: 5 });
  const refs = Array.from({ length: 12 }, (_, i) => ({ url: `https://ref.example/${i}`, tags: [] }));
  store.writeBatch({
    nodes: [
      { id: 'quake:1', type: 'natural_event', title: 'Q', occurredAt: '2026-10-29T00:00:00Z', lat: 1, lon: 2, geoBasis: 'coordinates' },
      { id: 'vendor:a', type: 'vendor', title: 'A' },
      { id: 'cve:CVE-1', type: 'vulnerability', title: 'V', summary: 'Same text', occurredAt: '2026-10-29T00:00:00Z', attrs: { kev: { description: 'Same text', dueDate: 'x' }, nvd: { references: refs } } },
      { id: 'cve:CVE-2', type: 'vulnerability', title: 'W', summary: 'NVD text', occurredAt: '2026-10-29T00:00:00Z', attrs: { kev: { description: 'CISA text' } } },
    ],
    edges: [{ src: 'quake:1', dst: 'vendor:a', rel: 'mentions', basis: 'inferred', confidence: 0.6, rationale: 'r', sourceId: 's' }],
    provenance: [
      { nodeId: 'quake:1', sourceId: 's', sourceUrl: 'https://specific.example/1' },
      { nodeId: 'vendor:a', sourceId: 's', sourceUrl: 'https://source.example/' },
    ],
  });
  return store;
}

describe('snapshot export (format 2)', () => {
  const snap = buildSnapshot(seed(), () => new Date('2026-10-30T01:00:00Z'));

  it('is compact: tuples for edges and provenance, no null fields', () => {
    expect(snap).toMatchObject({ format: SNAPSHOT_FORMAT, generatedAt: '2026-10-30T01:00:00.000Z' });
    expect(snap.edges).toEqual([['quake:1', 'vendor:a', 'mentions', 'i', 0.6, 'r', 's']]);
    // A URL equal to the source homepage is omitted; a specific one is kept.
    expect(snap.provenance).toEqual([
      ['quake:1', 's', 'https://specific.example/1', '2026-10-30T00:00:00.000Z'],
      ['vendor:a', 's', null, '2026-10-30T00:00:00.000Z'],
    ]);
    const vendor = snap.nodes.find((n) => n.id === 'vendor:a')!;
    expect(Object.values(vendor)).not.toContain(null);
    expect(vendor).not.toHaveProperty('lat');
  });

  it('trims only presentation-redundant detail', () => {
    const v1 = snap.nodes.find((n) => n.id === 'cve:CVE-1')! as { attrs: { kev: object; nvd: { references: unknown[]; referenceCount: number } } };
    expect(v1.attrs.nvd.references).toHaveLength(MAX_REFERENCES);
    expect(v1.attrs.nvd.referenceCount).toBe(12);
    expect(v1.attrs.kev).toEqual({ dueDate: 'x' }); // duplicate of the summary dropped
    const v2 = snap.nodes.find((n) => n.id === 'cve:CVE-2')! as { attrs: { kev: { description: string } } };
    expect(v2.attrs.kev.description).toBe('CISA text'); // different text is kept
  });

  it('expands back to the shapes the static engine uses', () => {
    const { nodes, edges, provenance } = expandSnapshot(JSON.parse(JSON.stringify(snap)) as Snapshot);
    expect(edges[0]).toMatchObject({ src: 'quake:1', dst: 'vendor:a', rel: 'mentions', basis: 'inferred', confidence: 0.6, rationale: 'r', sourceId: 's' });
    expect(provenance[1]).toEqual({ nodeId: 'vendor:a', sourceId: 's', sourceUrl: null, fetchedAt: '2026-10-30T00:00:00.000Z' });
    const vendor = nodes.find((n) => n.id === 'vendor:a')!;
    expect(vendor).toMatchObject({ lat: null, lon: null, geoBasis: null, summary: null, attrs: {} });
    expect(nodes.find((n) => n.id === 'quake:1')).toMatchObject({ lat: 1, lon: 2, geoBasis: 'coordinates' });
  });

  it('still reads the old plain format', () => {
    const old = { ...snap, format: 1, edges: [{ src: 'a', dst: 'b', rel: 'x', basis: 'reported', confidence: 1, rationale: null, sourceId: 's', observedAt: 't' }], provenance: [{ nodeId: 'a', sourceId: 's', sourceUrl: null, fetchedAt: 't' }] } as unknown as Snapshot;
    expect(expandSnapshot(old).edges[0]!.basis).toBe('reported');
  });
});
