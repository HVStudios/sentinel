import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseKev, type KevFeed } from '../src/sources/kev.ts';
import { bestCvss, parseCpe, parseNvd, type NvdResponse } from '../src/sources/nvd.ts';
import { parseEpss, type EpssResponse } from '../src/sources/epss.ts';
import { parseUsgs, type UsgsFeed } from '../src/sources/usgs.ts';
import { parseEonet, type EonetFeed } from '../src/sources/eonet.ts';
import { parseGdelt, parseSeenDate, type GdeltResponse } from '../src/sources/gdelt.ts';
import { classifyHn, parseHn, type HnResponse } from '../src/sources/hn.ts';
import { slug, toIso } from '../src/sources/common.ts';

const fixture = <T>(name: string): T => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as T;

describe('common helpers', () => {
  it('slugs vendor and product names consistently with CPE identifiers', () => {
    expect(slug('Connect Secure')).toBe('connect-secure');
    expect(slug('connect_secure')).toBe('connect-secure');
    expect(slug('Señor Café')).toBe('senor-cafe');
    expect(slug('***')).toBe('unknown');
  });

  it('normalises dates to UTC ISO strings', () => {
    expect(toIso('2024-05-02')).toBe('2024-05-02T00:00:00.000Z');
    expect(toIso('2021-12-10T10:15:09.143')).toBe('2021-12-10T10:15:09.143Z');
    expect(toIso('2021-12-10T10:15:09+02:00')).toBe('2021-12-10T08:15:09.000Z');
    expect(toIso('not a date')).toBeNull();
    expect(toIso(undefined)).toBeNull();
  });
});

describe('CISA KEV parser', () => {
  const batch = parseKev(fixture<KevFeed>('kev.json'));

  it('creates a vulnerability node per entry with KEV facts preserved', () => {
    const log4j = batch.nodes.find((n) => n.id === 'cve:CVE-2021-44228')!;
    expect(log4j).toMatchObject({ type: 'vulnerability', category: 'kev', occurredAt: '2021-12-10T00:00:00.000Z' });
    expect(log4j.url).toBe('https://nvd.nist.gov/vuln/detail/CVE-2021-44228');
    expect(log4j.attrs?.kev).toMatchObject({ dateAdded: '2021-12-10', ransomware: 'Known', vendorProject: 'Apache' });
    expect(log4j.geoBasis ?? null).toBeNull();
  });

  it('links CVE → product → vendor and CVE → CWE as reported facts', () => {
    expect(batch.edges).toContainEqual(expect.objectContaining({ src: 'cve:CVE-2021-44228', dst: 'product:apache/log4j2', rel: 'affects', basis: 'reported' }));
    expect(batch.edges).toContainEqual(expect.objectContaining({ src: 'product:apache/log4j2', dst: 'vendor:apache', rel: 'made_by' }));
    expect(batch.edges.filter((e) => e.rel === 'has_weakness').length).toBeGreaterThan(0);
    expect(batch.edges.every((e) => e.basis === 'reported' && e.confidence === 1)).toBe(true);
  });

  it('trims stray whitespace in vendor and product names', () => {
    const b = parseKev({ catalogVersion: 'x', dateReleased: 'x', vulnerabilities: [{ ...fixture<KevFeed>('kev.json').vulnerabilities[0]!, vendorProject: 'Array Networks ', product: ' AG ' }] });
    expect(b.nodes.find((n) => n.type === 'vendor')!.title).toBe('Array Networks');
    expect(b.nodes.find((n) => n.type === 'product')!.title).toBe('Array Networks AG');
  });

  it('extracts URLs from the notes field', () => {
    const ivanti = batch.nodes.find((n) => n.id === 'cve:CVE-2026-111357')!;
    const notes = (ivanti.attrs?.kev as { notes: string[] }).notes;
    expect(notes.length).toBeGreaterThan(1);
    expect(notes.every((u) => u.startsWith('https://'))).toBe(true);
  });

  it('attributes every node to the source and deduplicates reference nodes', () => {
    const ids = batch.nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(batch.provenance.map((p) => p.nodeId))).toEqual(new Set(ids));
  });
});

describe('NVD parser', () => {
  const resp = fixture<NvdResponse>('nvd.json');

  it('picks the best available CVSS metric', () => {
    const log4j = resp.vulnerabilities[0]!.cve;
    expect(bestCvss(log4j.metrics)).toMatchObject({ version: '3.1', score: 10, severity: 'CRITICAL' });
    expect(bestCvss(undefined)).toBeNull();
  });

  it('parses CPE 2.3 names', () => {
    expect(parseCpe('cpe:2.3:a:ivanti:connect_secure:*:*:*:*:*:*:*:*')).toEqual({ part: 'a', vendor: 'ivanti', product: 'connect_secure' });
    expect(parseCpe('cpe:2.3:a:*:*:*')).toBeNull();
    expect(parseCpe('garbage')).toBeNull();
  });

  it('enriches CVEs with CVSS, dates, references and products', () => {
    const batch = parseNvd(resp);
    const ivanti = batch.nodes.find((n) => n.id === 'cve:CVE-2026-111357')!;
    expect(ivanti.occurredAt).toBe('2026-10-30T00:00:00.000Z'); // cisaExploitAdd wins over published
    expect(ivanti.publishedAt).toMatch(/Z$/);
    expect((ivanti.attrs?.cvss as { score: number }).score).toBe(7);
    expect(batch.edges).toContainEqual(expect.objectContaining({ src: 'cve:CVE-2026-111357', dst: 'product:ivanti/connect-secure', rel: 'affects' }));
    const vendor = batch.nodes.find((n) => n.id === 'vendor:ivanti');
    expect(vendor?.title).toBe('Ivanti');
  });

  it('skips malformed records without losing the rest of the page', () => {
    const broken = { ...resp, vulnerabilities: [{ cve: { id: 'CVE-2099-0002' } as never }, ...resp.vulnerabilities, { cve: { ...resp.vulnerabilities[0]!.cve, id: 'CVE-2099-0003', configurations: [{}] } as never }] };
    const batch = parseNvd(broken);
    expect(batch.skipped).toEqual(['CVE-2099-0002']);
    expect(batch.nodes.some((n) => n.id === 'cve:CVE-2099-0003')).toBe(true); // configuration without nodes is fine
    expect(batch.nodes.some((n) => n.id === 'cve:CVE-2099-0002')).toBe(false);
  });

  it('drops non-notable recent CVEs when asked', () => {
    const lowScore: NvdResponse = {
      ...resp,
      vulnerabilities: [{ cve: { id: 'CVE-2099-0001', published: '2099-01-01T00:00:00.000', lastModified: '2099-01-01T00:00:00.000', descriptions: [{ lang: 'en', value: 'x' }] } }],
    };
    expect(parseNvd(lowScore, { onlyNotable: true }).nodes).toHaveLength(0);
    expect(parseNvd(lowScore).nodes).toHaveLength(1);
  });
});

describe('EPSS parser', () => {
  it('only enriches known CVEs and keeps score date', () => {
    const batch = parseEpss(fixture<EpssResponse>('epss.json'), new Set(['cve:CVE-2021-44228']));
    expect(batch.nodes).toHaveLength(1);
    expect(batch.nodes[0]).toMatchObject({ id: 'cve:CVE-2021-44228', title: '' });
    expect(batch.nodes[0]!.attrs?.epss).toMatchObject({ score: 0.99999, percentile: 1, date: '2026-10-30' });
  });
});

describe('USGS parser', () => {
  it('uses source coordinates verbatim', () => {
    const feed = fixture<UsgsFeed>('usgs.json');
    const batch = parseUsgs(feed);
    expect(batch.nodes).toHaveLength(feed.features.length);
    const first = batch.nodes[0]!;
    const [lon, lat] = feed.features[0]!.geometry!.coordinates;
    expect(first).toMatchObject({ type: 'natural_event', category: 'earthquake', lat, lon, geoBasis: 'coordinates' });
    expect(first.severity).toBeGreaterThan(0);
    expect(first.severity).toBeLessThanOrEqual(1);
  });
});

describe('NASA EONET parser', () => {
  it('uses the latest point geometry and skips excluded categories', () => {
    const feed = fixture<EonetFeed>('eonet.json');
    const batch = parseEonet(feed);
    expect(batch.nodes.length).toBeGreaterThan(0);
    expect(batch.nodes.every((n) => n.category !== 'seaLakeIce')).toBe(true);
    for (const node of batch.nodes) {
      const ev = feed.events.find((e) => `eonet:${e.id}` === node.id)!;
      const latest = [...ev.geometry].sort((a, b) => a.date.localeCompare(b.date)).at(-1)!;
      expect([node.lon, node.lat]).toEqual(latest.coordinates);
      expect(node.geoBasis).toBe('coordinates');
    }
  });

  it('does not derive locations from polygon geometries', () => {
    const batch = parseEonet({
      events: [{ id: 'X', title: 'Polygon only', description: null, link: 'l', closed: null, categories: [{ id: 'floods', title: 'Floods' }], sources: [],
        geometry: [{ date: '2026-01-01T00:00:00Z', type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }] }],
    });
    expect(batch.nodes).toHaveLength(0);
    expect(batch.skipped).toBe(1);
  });
});

describe('GDELT parser', () => {
  it('stores publisher country, never an event location', () => {
    const batch = parseGdelt(fixture<GdeltResponse>('gdelt.json'), 'security-news');
    expect(batch.nodes).toHaveLength(3);
    const de = batch.nodes[0]!;
    expect(de).toMatchObject({ type: 'article', country: 'Germany', geoBasis: 'publisher_country', occurredAt: '2026-08-19T03:30:00.000Z' });
    expect(de.lat ?? null).toBeNull();
    expect(batch.nodes[2]).toMatchObject({ country: null, geoBasis: null });
  });

  it('parses GDELT seen dates', () => {
    expect(parseSeenDate('20260819T033000Z')).toBe('2026-08-19T03:30:00.000Z');
    expect(parseSeenDate('bad')).toBeNull();
    expect(parseGdelt({}, 'x').nodes).toHaveLength(0);
  });
});

describe('Hacker News parser', () => {
  it('creates articles without geography', () => {
    const batch = parseHn(fixture<HnResponse>('hn.json'));
    expect(batch.nodes.length).toBeGreaterThan(0);
    expect(batch.nodes.every((n) => n.geoBasis == null && n.country == null && n.lat == null)).toBe(true);
    expect(batch.nodes[0]!.attrs).toHaveProperty('hnUrl');
  });

  it('classifies stories', () => {
    expect(classifyHn('Critical RCE in Example server (CVE-2026-1234)')).toBe('security-news');
    expect(classifyHn('Anthropic releases a new Claude model')).toBe('ai');
    expect(classifyHn('Show HN: A tiny text editor')).toBe('tech');
    expect(classifyHn('Maintaining a garden')).toBe('tech'); // "AI" inside words must not match
  });
});
