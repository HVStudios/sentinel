import { describe, expect, it } from 'vitest';
import world from 'world-atlas/countries-110m.json';
import { badgesFor, categoryLabel, formatDate, locationLabel, relativeTime } from '../src/lib/format.ts';
import { createCountryResolver } from '../src/lib/countries.ts';
import { layoutGraph, shortLabel } from '../src/components/Graph.tsx';
import { article, kevCve, node, quake } from './fixtures.ts';

describe('format helpers', () => {
  const now = new Date('2026-10-30T12:00:00Z');

  it('formats relative times', () => {
    expect(relativeTime('2026-10-30T11:59:30Z', now)).toBe('just now');
    expect(relativeTime('2026-10-30T09:00:00Z', now)).toBe('3h ago');
    expect(relativeTime('2026-10-20T12:00:00Z', now)).toBe('10d ago');
    expect(relativeTime('2026-11-01T12:00:00Z', now)).toBe('in 2d');
    expect(relativeTime(null, now)).toBe('unknown time');
  });

  it('formats absolute UTC dates', () => {
    expect(formatDate('2026-10-30T09:05:00.000Z')).toBe('2026-10-30 09:05 UTC');
    expect(formatDate(null)).toBe('—');
  });

  it('describes location honestly by basis', () => {
    expect(locationLabel(quake)).toBe('southeast of Easter Island · -36.41°, -98.05° (source coordinates)');
    expect(locationLabel(article)).toBe('Publisher in Germany (not the event location)');
    expect(locationLabel(kevCve)).toBe('No location reported by source');
    const vendor = (confidence: number) => node({ id: 'vendor:x', type: 'vendor', title: 'X', attrs: { wikidata: { status: 'matched', confidence, hq: { label: 'Oslo', country: 'Norway' } } } });
    expect(locationLabel(vendor(0.8))).toBe('Headquarters: Oslo, Norway (Wikidata)');
    expect(locationLabel(vendor(0.55))).toBe('Possibly headquartered in Oslo, Norway (Wikidata alias match; not mapped)');
  });

  it('labels GDACS centroids and events that are not drawn as a point', () => {
    const tc = node({ id: 'gdacs:TC1', type: 'natural_event', title: 'TC', geoBasis: 'coordinates', lat: 16.4, lon: 81.8, attrs: { locationKind: 'centroid' } });
    expect(locationLabel(tc)).toBe('16.40°, 81.80° (GDACS centroid of the affected area)');
    const drought = node({ id: 'gdacs:DR1', type: 'natural_event', title: 'Drought', attrs: { gdacs: { affectedCountries: ['A', 'B', 'C', 'D'] } } });
    expect(locationLabel(drought)).toBe('Not shown as a point: affects 4 countries (GDACS)');
  });

  it('badges GDACS alerts and GitHub advisories', () => {
    expect(badgesFor(node({ id: 'g', type: 'natural_event', title: 'x', attrs: { gdacs: { alertLevel: 'Red' } } })).map((b) => [b.label, b.tone])).toEqual([['GDACS Red', 'critical']]);
    const ghsa = badgesFor(node({ id: 'ghsa:x', type: 'vulnerability', title: 'x', attrs: { ghsa: { id: 'GHSA-x', severity: 'high', packages: [{ ecosystem: 'npm' }, { ecosystem: 'pip' }] }, cvss: { score: 8.1, version: '3.1', vector: 'v', source: 'GitHub' } } }));
    expect(ghsa.map((b) => b.label)).toEqual(['CVSS 8.1', 'GHSA']);
    expect(ghsa[1]!.title).toContain('npm, pip');
  });

  it('derives risk badges from source facts', () => {
    expect(badgesFor(kevCve).map((b) => b.label)).toEqual(['KEV', 'Ransomware', 'CVSS 7.0', 'EPSS 0.3%']);
    expect(badgesFor(quake).map((b) => b.label)).toEqual(['M6.4', 'PAGER green']);
    expect(badgesFor(node({ id: 'v', type: 'vendor', title: 'x' }))).toEqual([]);
  });

  it('labels categories with a fallback', () => {
    expect(categoryLabel('kev')).toBe('Known exploited');
    expect(categoryLabel('somethingNew')).toBe('somethingNew');
    expect(categoryLabel(null)).toBe('');
  });
});

describe('country resolver', () => {
  const names = (world as { objects: { countries: { geometries: { properties: { name: string } }[] } } }).objects.countries.geometries.map((g) => g.properties.name);
  const resolve = createCountryResolver(names);

  it('maps source country names onto the base map', () => {
    expect(resolve('Germany')).toBe('Germany');
    expect(resolve('United States')).toBe('United States of America');
    expect(resolve('czech republic')).toBe('Czechia');
    expect(resolve('Russian Federation')).toBe('Russia');
  });

  it('leaves countries absent from the base map unmapped instead of guessing', () => {
    expect(resolve('Singapore')).toBeNull();
    expect(resolve('Atlantis')).toBeNull();
  });
});

describe('graph layout', () => {
  it('positions every node and pins the root at the centre', () => {
    const nodes = [kevCve, article, node({ id: 'product:ivanti/connect-secure', type: 'product', title: 'Ivanti Connect Secure', attrs: { vendor: 'Ivanti' } })];
    const edges = [
      { src: article.id, dst: kevCve.id, rel: 'mentions', basis: 'inferred' as const, confidence: 0.95, rationale: null, sourceId: 's', observedAt: '' },
      { src: kevCve.id, dst: nodes[2]!.id, rel: 'affects', basis: 'reported' as const, confidence: 1, rationale: null, sourceId: 's', observedAt: '' },
      { src: kevCve.id, dst: 'missing', rel: 'affects', basis: 'reported' as const, confidence: 1, rationale: null, sourceId: 's', observedAt: '' },
    ];
    const layout = layoutGraph(nodes, edges, kevCve.id);
    expect(layout.links).toHaveLength(2); // edges to nodes outside the subgraph are dropped
    const root = layout.nodes.find((n) => n.id === kevCve.id)!;
    expect([root.x, root.y]).toEqual([0, 0]);
    expect(layout.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y))).toBe(true);
  });

  it('shortens labels', () => {
    expect(shortLabel(kevCve)).toBe('CVE-2026-111357');
    expect(shortLabel(node({ id: 'p', type: 'product', title: 'Ivanti Connect Secure', attrs: { vendor: 'Ivanti' } }))).toBe('Connect Secure');
    expect(shortLabel(node({ id: 'a', type: 'article', title: 'A very long headline that keeps going' }))).toBe('A very long headline …');
  });
});
