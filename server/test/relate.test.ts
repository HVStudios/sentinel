import { describe, expect, it } from 'vitest';
import { buildVendorMatchers, extractCves, inferEdges, isMatchableVendor, runInference, vulnerabilitySeverity } from '../src/relate.ts';
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

  it('ranks vulnerability severity from KEV, CVSS and EPSS', () => {
    expect(vulnerabilitySeverity({})).toBe(0);
    expect(vulnerabilitySeverity({ kev: {} })).toBe(0.75);
    expect(vulnerabilitySeverity({ kev: {}, cvss: { score: 9.8 } })).toBeCloseTo(0.98);
    expect(vulnerabilitySeverity({ cvss: { score: 5 }, epss: { score: 0.9 } })).toBe(0.9);
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
    expect(store.getNode('cve:CVE-2026-0001')!.severity).toBe(0.75);
  });
});
