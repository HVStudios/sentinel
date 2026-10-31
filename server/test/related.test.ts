import { describe, expect, it } from 'vitest';
import { Store } from '../src/store.ts';

const T = (d: number) => `2026-10-${String(d).padStart(2, '0')}T12:00:00.000Z`;

function seed() {
  const store = new Store();
  store.registerSource({ id: 's', name: 's', homepage: 'h', description: 'd' });
  const e = (src: string, dst: string, rel: string, basis: 'reported' | 'inferred' = 'reported') => ({ src, dst, rel, basis, confidence: 1, sourceId: 's' });
  store.writeBatch({
    nodes: [
      { id: 'vendor:acme', type: 'vendor', title: 'Acme' },
      { id: 'product:acme/router', type: 'product', title: 'Acme Router' },
      { id: 'cve:CVE-1', type: 'vulnerability', title: 'Router RCE', occurredAt: T(28), attrs: { cveId: 'CVE-1' } },
      { id: 'cve:CVE-2', type: 'vulnerability', title: 'Router auth bypass', occurredAt: T(30), attrs: { cveId: 'CVE-2' } },
      { id: 'cve:OTHER', type: 'vulnerability', title: 'Unrelated', occurredAt: T(30) },
      { id: 'news:a', type: 'article', title: 'Router RCE exploited', occurredAt: T(29) },
      { id: 'news:b', type: 'article', title: 'Acme earnings', occurredAt: T(27) },
      { id: 'cwe:CWE-79', type: 'weakness', title: 'CWE-79' },
      { id: 'story:x', type: 'story', title: 'Story', occurredAt: T(30) },
    ],
    edges: [
      e('product:acme/router', 'vendor:acme', 'made_by'),
      e('cve:CVE-1', 'product:acme/router', 'affects'),
      e('cve:CVE-2', 'product:acme/router', 'affects'),
      e('news:a', 'cve:CVE-1', 'mentions', 'inferred'),
      e('news:b', 'vendor:acme', 'mentions', 'inferred'),
      e('cve:CVE-2', 'cve:CVE-1', 'references', 'inferred'),
      e('cve:CVE-1', 'cwe:CWE-79', 'has_weakness'),
      e('cve:CVE-1', 'story:x', 'part_of', 'inferred'),
      e('news:a', 'story:x', 'part_of', 'inferred'),
    ],
    provenance: [],
  });
  return store;
}

const view = (rows: { node: { id: string }; via: string }[]) => rows.map((r) => `${r.node.id} ← ${r.via}`);

describe('related items for watched nodes', () => {
  const store = seed();

  it('vendor: vulnerabilities in its products and articles naming it, newest first', () => {
    expect(view(store.related('vendor:acme'))).toEqual([
      'cve:CVE-2 ← affects Acme Router',
      'cve:CVE-1 ← affects Acme Router',
      'news:b ← mentions Acme',
    ]);
  });

  it('product: its vulnerabilities and the articles mentioning them', () => {
    expect(view(store.related('product:acme/router'))).toEqual([
      'cve:CVE-2 ← affects Acme Router',
      'news:a ← mentions CVE-1',
      'cve:CVE-1 ← affects Acme Router',
    ]);
  });

  it('vulnerability: mentions and exploit-chain neighbours, never unrelated items', () => {
    expect(view(store.related('cve:CVE-1'))).toEqual(['cve:CVE-2 ← references CVE-1', 'news:a ← mentions CVE-1']);
    expect(view(store.related('cve:CVE-2'))).toEqual(['cve:CVE-1 ← referenced by CVE-2']);
  });

  it('weakness and story', () => {
    expect(view(store.related('cwe:CWE-79'))).toEqual(['cve:CVE-1 ← has weakness CWE-79']);
    expect(view(store.related('story:x'))).toEqual(['news:a ← part of this story', 'cve:CVE-1 ← part of this story']);
  });

  it('handles unknown ids and limits', () => {
    expect(store.related('nope')).toEqual([]);
    expect(store.related('vendor:acme', 1)).toHaveLength(1);
  });
});
