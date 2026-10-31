import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { distanceKm, findExisting, parseGdacs, type GdacsResponse } from '../src/sources/gdacs.ts';
import type { NodeRow } from '../src/store.ts';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/gdacs.json', import.meta.url), 'utf8')) as GdacsResponse;
const node = (over: Partial<NodeRow> & Pick<NodeRow, 'id' | 'title'>): NodeRow =>
  ({ type: 'natural_event', ingestedAt: 'x', attrs: {}, lat: null, lon: null, ...over }) as NodeRow;

describe('GDACS parser (recorded response)', () => {
  const b = parseGdacs(fixture);
  const byTitle = (re: RegExp) => b.nodes.find((n) => re.test(n.title))!;

  it('maps event types to categories and alert levels to severity', () => {
    expect(byTitle(/ARNAB/)).toMatchObject({ category: 'severeStorms', severity: 0.9 });
    expect(byTitle(/Kanlaon/)).toMatchObject({ category: 'volcanoes', severity: 0.65 });
    expect(byTitle(/ARNAB/).attrs).toMatchObject({ gdacs: { alertLevel: 'Red', eventType: 'TC' }, locationKind: 'centroid' });
    expect(byTitle(/Kanlaon/).attrs).toMatchObject({ locationKind: 'epicentre' });
  });

  it('does not reduce droughts or multi-country events to a single point', () => {
    const drought = byTitle(/Drought in Andorra/);
    expect(drought.geoBasis ?? null).toBeNull();
    expect(drought.lat ?? null).toBeNull();
    expect((drought.attrs!.gdacs as { affectedCountries: string[] }).affectedCountries.length).toBeGreaterThan(3);
    expect(drought.summary).toContain('Affected:');
  });

  it('keeps reported coordinates for localised events and links the GDACS report', () => {
    const quake = byTitle(/Earthquake in Panama/);
    expect(quake).toMatchObject({ geoBasis: 'coordinates', lon: -80.769, lat: 7.5868 });
    expect(quake.url).toMatch(/^https:\/\/www\.gdacs\.org\//);
    expect(b.provenance.length).toBe(b.nodes.length);
    expect(new Set(b.nodes.map((n) => n.id)).size).toBe(b.nodes.length);
  });

  it('enriches a matching USGS quake instead of drawing a duplicate', () => {
    const usgs = node({ id: 'quake:us1', title: 'M 6.6 - Panama', occurredAt: '2026-10-09T17:56:30.000Z', lat: 7.6, lon: -80.7, severity: 0.5 });
    const out = parseGdacs(fixture, [usgs]);
    const enriched = out.nodes.find((n) => n.id === 'quake:us1')!;
    expect(enriched).toMatchObject({ title: '', severity: 0.65, attrs: { gdacs: { alertLevel: 'Orange' } } });
    expect(out.nodes.some((n) => /Earthquake in Panama/.test(n.title))).toBe(false);
  });

  it('enriches a matching EONET storm by name', () => {
    const eonet = node({ id: 'eonet:EONET_1', title: 'Tropical Cyclone Arnab', category: 'severeStorms', severity: 0.3 });
    const f = fixture.features!.find((x) => /ARNAB/.test(x.properties.name))!;
    expect(findExisting(f, [eonet])?.id).toBe('eonet:EONET_1');
    expect(findExisting(f, [{ ...eonet, category: 'wildfires' }])).toBeUndefined();
  });

  it('does not match quakes that are far apart or minutes apart', () => {
    const f = fixture.features!.find((x) => /Earthquake in Panama/.test(x.properties.name))!;
    expect(findExisting(f, [node({ id: 'quake:far', title: 'x', occurredAt: '2026-10-09T17:56:06.000Z', lat: 9.5, lon: -80.7 })])).toBeUndefined();
    expect(findExisting(f, [node({ id: 'quake:late', title: 'x', occurredAt: '2026-10-09T18:10:00.000Z', lat: 7.6, lon: -80.7 })])).toBeUndefined();
  });

  it('computes great-circle distances', () => {
    expect(distanceKm({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(111.2, 0);
  });
});
