import { describe, expect, it } from 'vitest';
import { pruneExpired, RETENTION_DAYS } from '../src/retention.ts';
import { Store } from '../src/store.ts';

const NOW = new Date('2026-11-02T00:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

describe('retention', () => {
  it('expires old articles, events and non-KEV vulnerabilities; keeps KEV and fresh items; drops orphans', () => {
    const store = new Store();
    store.registerSource({ id: 's', name: 's', homepage: 'h', description: 'd' });
    const e = (src: string, dst: string, rel: string) => ({ src, dst, rel, basis: 'reported' as const, confidence: 1, sourceId: 's' });
    store.writeBatch({
      nodes: [
        { id: 'news:old', type: 'article', title: 'old', occurredAt: daysAgo(RETENTION_DAYS.article + 1) },
        { id: 'news:new', type: 'article', title: 'new', occurredAt: daysAgo(RETENTION_DAYS.article - 1) },
        { id: 'quake:old', type: 'natural_event', title: 'old', occurredAt: daysAgo(RETENTION_DAYS.natural_event + 1) },
        { id: 'quake:new', type: 'natural_event', title: 'new', occurredAt: daysAgo(30) },
        { id: 'cve:OLD-NVD', type: 'vulnerability', title: 'old nvd', occurredAt: daysAgo(RETENTION_DAYS.vulnerability + 1) },
        { id: 'cve:OLD-KEV', type: 'vulnerability', title: 'old kev', occurredAt: daysAgo(2000), attrs: { kev: { dateAdded: '2021-01-01' } } },
        { id: 'product:only-old/x', type: 'product', title: 'only used by expired' },
        { id: 'product:kev/y', type: 'product', title: 'used by KEV' },
        { id: 'vendor:old', type: 'vendor', title: 'old vendor' },
        { id: 'cwe:CWE-1', type: 'weakness', title: 'CWE-1' },
      ],
      edges: [
        e('cve:OLD-NVD', 'product:only-old/x', 'affects'),
        e('product:only-old/x', 'vendor:old', 'made_by'),
        e('cve:OLD-NVD', 'cwe:CWE-1', 'has_weakness'),
        e('cve:OLD-KEV', 'product:kev/y', 'affects'),
        e('news:old', 'cve:OLD-KEV', 'mentions'),
      ],
      provenance: [{ nodeId: 'news:old', sourceId: 's' }, { nodeId: 'vendor:old', sourceId: 's' }, { nodeId: 'cve:OLD-KEV', sourceId: 's' }],
    });

    expect(pruneExpired(store, NOW)).toEqual({ expired: 3, orphans: 3 });
    const ids = store.db.prepare('select id from nodes order by id').all().map((r) => (r as { id: string }).id);
    expect(ids).toEqual(['cve:OLD-KEV', 'news:new', 'product:kev/y', 'quake:new']);
    // Edges and provenance of removed nodes are gone; the KEV entry keeps its own.
    expect(store.edgesOf('cve:OLD-KEV').map((x) => x.dst)).toEqual(['product:kev/y']);
    expect(store.provenanceFor('news:old')).toEqual([]);
    expect(store.provenanceFor('vendor:old')).toEqual([]);
    expect(store.provenanceFor('cve:OLD-KEV')).toHaveLength(1);
    // Running again changes nothing.
    expect(pruneExpired(store, NOW)).toEqual({ expired: 0, orphans: 0 });
  });
});
