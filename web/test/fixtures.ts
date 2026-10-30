import type { NodeDetail, SNode } from '../src/api.ts';

export const node = (over: Partial<SNode> & Pick<SNode, 'id' | 'type' | 'title'>): SNode => ({
  summary: null,
  url: null,
  category: null,
  occurredAt: '2026-10-30T10:00:00.000Z',
  publishedAt: null,
  updatedAt: null,
  ingestedAt: '2026-10-30T12:00:00.000Z',
  lat: null,
  lon: null,
  country: null,
  geoBasis: null,
  severity: null,
  attrs: {},
  ...over,
});

export const kevCve = node({
  id: 'cve:CVE-2026-111357',
  type: 'vulnerability',
  title: 'Ivanti Connect Secure Missing Authentication',
  category: 'kev',
  url: 'https://nvd.nist.gov/vuln/detail/CVE-2026-111357',
  severity: 0.75,
  attrs: {
    cveId: 'CVE-2026-111357',
    kev: { dateAdded: '2026-10-30', dueDate: '2026-11-02', ransomware: 'Known', requiredAction: 'Apply mitigations.' },
    cvss: { score: 7, version: '3.1', severity: 'HIGH', vector: 'CVSS:3.1/AV:L', source: 'cve@mitre.org' },
    epss: { score: 0.00316, percentile: 0.2457, date: '2026-10-30' },
  },
});

export const quake = node({
  id: 'quake:us7000ttxz',
  type: 'natural_event',
  title: 'M 6.4 - southeast of Easter Island',
  category: 'earthquake',
  lat: -36.4058,
  lon: -98.0489,
  geoBasis: 'coordinates',
  severity: 0.48,
  attrs: { mag: 6.4, magType: 'mww', place: 'southeast of Easter Island', alert: 'green' },
});

export const article = node({
  id: 'news:abc',
  type: 'article',
  title: 'Ivanti flaw exploited',
  category: 'security-news',
  url: 'https://example.org/story',
  country: 'Germany',
  geoBasis: 'publisher_country',
  attrs: { domain: 'example.org' },
});

export const detail: NodeDetail = {
  node: kevCve,
  provenance: [
    { id: 'cisa-kev', name: 'CISA KEV', homepage: 'https://www.cisa.gov', description: 'Exploited vulns', sourceUrl: null, fetchedAt: '2026-10-30T12:00:00.000Z' },
  ],
  edges: [
    {
      src: 'cve:CVE-2026-111357', dst: 'product:ivanti/connect-secure', rel: 'affects', basis: 'reported', confidence: 1, rationale: null,
      sourceId: 'cisa-kev', observedAt: '2026-10-30T12:00:00.000Z', direction: 'out',
      other: { id: 'product:ivanti/connect-secure', type: 'product', title: 'Ivanti Connect Secure' },
    },
    {
      src: 'news:abc', dst: 'cve:CVE-2026-111357', rel: 'mentions', basis: 'inferred', confidence: 0.95,
      rationale: 'Text contains the exact identifier CVE-2026-111357.', sourceId: 'sentinel-inference', observedAt: '2026-10-30T12:00:00.000Z',
      direction: 'in', other: { id: 'news:abc', type: 'article', title: 'Ivanti flaw exploited' },
    },
  ],
};
