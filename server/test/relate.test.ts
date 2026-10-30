import { describe, expect, it } from 'vitest';
import { articleRank, buildVendorMatchers, extractCves, inferEdges, isMatchableVendor, runInference, vulnerabilitySeverity } from '../src/relate.ts';
import { Store } from '../src/store.ts';

describe('relationship inference', () => {
  const vendors = buildVendorMatchers([
    { id: 'vendor:ivanti', title: 'Ivanti' },
    { id: 'vendor:sap', title: 'SAP' },
    { id: 'vendor:progress', title: 'Progress' },
    { id: 'vendor:multiple-vendors', title: 'Multiple Vendors' },
    { id: 'vendor:arm', title: 'Arm' },
  ]);

  it('filters vendor names that would match ordinary words', () => {
    expect(vendors.map((v) => v.name)).toEqual(['Ivanti', 'SAP']);
    expect(isMatchableVendor('D-Link')).toBe(true);
    expect(isMatchableVendor('Arm')).toBe(false);
  });

  it('extracts unique, upper-cased CVE identifiers', () => {
    expect(extractCves('cve-2024-1234 and CVE-2024-1234, CVE-2023-99999')).toEqual(['CVE-2024-1234', 'CVE-2023-99999']);
    expect(extractCves('CVE-24-1')).toEqual([]);
  });

  it('infers mentions with confidence and rationale, only to known CVEs', () => {
    const known = new Set(['cve:CVE-2026-0001', 'cve:CVE-2026-0002']);
    const edges = inferEdges(
      [
        { id: 'news:1', title: 'Ivanti patches CVE-2026-0001 and CVE-2026-9999', summary: null },
        { id: 'news:2', title: 'Ivantis everywhere; SAPPHIRE conference', summary: null },
        { id: 'news:3', title: 'SAP warns customers', summary: null },
      ],
      [{ id: 'cve:CVE-2026-0002', summary: 'NVD text', attrs: { kev: { description: 'Can be chained with CVE-2026-0001 and CVE-2026-0002.' } } }],
      vendors,
      (id) => known.has(id),
    );
    expect(edges).toEqual([
      expect.objectContaining({ src: 'news:1', dst: 'cve:CVE-2026-0001', rel: 'mentions', basis: 'inferred', confidence: 0.95 }),
      expect.objectContaining({ src: 'news:1', dst: 'vendor:ivanti', rel: 'mentions', basis: 'inferred', confidence: 0.6 }),
      expect.objectContaining({ src: 'news:3', dst: 'vendor:sap', confidence: 0.6 }),
      expect.objectContaining({ src: 'cve:CVE-2026-0002', dst: 'cve:CVE-2026-0001', rel: 'references', confidence: 0.9 }),
    ]);
    expect(edges.every((e) => e.rationale && e.rationale.length > 10)).toBe(true);
  });

  it('ranks known exploitation above theoretical severity', () => {
    expect(vulnerabilitySeverity({})).toBe(0);
    expect(vulnerabilitySeverity({ kev: {} })).toBe(0.9);
    expect(vulnerabilitySeverity({ kev: {}, cvss: { score: 9.8 } })).toBe(0.998);
    expect(vulnerabilitySeverity({ cvss: { score: 5 }, epss: { score: 0.9 } })).toBe(0.801);
    // An unexploited CVSS 10 still ranks below any KEV-listed CVE.
    expect(vulnerabilitySeverity({ cvss: { score: 10 } })).toBeLessThan(vulnerabilitySeverity({ kev: {}, cvss: { score: 4 } }));
  });

  it('ranks articles with explained factors', () => {
    expect(articleRank({ category: 'tech-news', attrs: {} }, { kevCves: 0, cves: 0 })).toEqual({ score: 0.3, factors: ['tech news (+0.30)'] });
    const hot = articleRank({ category: 'security-news', attrs: { points: 500 } }, { kevCves: 1, cves: 2 });
    expect(hot.score).toBe(0.85);
    expect(hot.factors).toEqual(['security news (+0.45)', '500 Hacker News points (+0.15)', 'mentions a CISA KEV-listed CVE (+0.25)']);
    expect(articleRank({ category: 'advisory', attrs: {} }, { kevCves: 0, cves: 3 }).score).toBe(0.65);
    expect(articleRank({ category: 'advisory', attrs: { points: 5000 } }, { kevCves: 2, cves: 2 }).score).toBe(1);
  });

  it('recomputes inferred edges without touching reported ones', () => {
    const store = new Store();
    store.registerSource({ id: 's', name: 's', homepage: 'h', description: 'd' });
    store.writeBatch({
      nodes: [
        { id: 'cve:CVE-2026-0001', type: 'vulnerability', title: 'x', attrs: { kev: {} } },
        { id: 'vendor:ivanti', type: 'vendor', title: 'Ivanti' },
        { id: 'news:1', type: 'article', title: 'Ivanti and CVE-2026-0001', occurredAt: '2026-01-01T00:00:00Z' },
      ],
      edges: [{ src: 'cve:CVE-2026-0001', dst: 'vendor:ivanti', rel: 'affects', basis: 'reported', confidence: 1, sourceId: 's' }],
      provenance: [],
    });
    expect(runInference(store).edges).toBe(2);
    expect(runInference(store).edges).toBe(2);
    expect(store.counts().edges).toBe(3);
    expect(store.getNode('cve:CVE-2026-0001')!.severity).toBe(0.9);
    // The article mentions a KEV-listed CVE, so its rank says so.
    const article = store.getNode('news:1')!;
    expect(article.severity).toBe(0.55);
    expect(article.attrs.rank).toEqual({ score: 0.55, factors: ['news (+0.30)', 'mentions a CISA KEV-listed CVE (+0.25)'] });
  });
});
