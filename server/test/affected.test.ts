import { describe, expect, it } from 'vitest';
import { aggregateAffected } from '../../shared/affected.ts';
import { Store } from '../src/store.ts';

const ev = (id: string, title: string, alertLevel: string, affectedCountries: string[]) => ({ id, title, attrs: { gdacs: { alertLevel, affectedCountries } } });

describe('GDACS affected countries', () => {
  it('keeps the most severe alert per country, lists its events, and orders by severity then name', () => {
    const out = aggregateAffected([
      ev('gdacs:DR1', 'Drought in Europe', 'Orange', ['Germany', 'Bosnia  and  Herzegovina']),
      ev('gdacs:FL1', 'Flood in Germany', 'Red', ['Germany']),
      ev('gdacs:TC1', 'Cyclone', 'Green', ['Japan']),
      { id: 'quake:1', title: 'No GDACS', attrs: {} },
    ]);
    expect(out.map((c) => [c.country, c.maxAlert])).toEqual([['Germany', 'Red'], ['Bosnia and Herzegovina', 'Orange'], ['Japan', 'Green']]);
    expect(out[0]!.events.map((e) => e.id)).toEqual(['gdacs:FL1', 'gdacs:DR1']);
  });

  it('comes from world events in the window only', () => {
    const store = new Store();
    store.registerSource({ id: 's', name: 's', homepage: 'h', description: 'd' });
    store.writeBatch({
      nodes: [
        { id: 'gdacs:DR1', type: 'natural_event', title: 'Drought', occurredAt: '2026-10-29T00:00:00.000Z', attrs: { gdacs: { alertLevel: 'Orange', affectedCountries: ['Spain', 'France'] } } },
        { id: 'gdacs:OLD', type: 'natural_event', title: 'Old flood', occurredAt: '2026-01-01T00:00:00.000Z', attrs: { gdacs: { alertLevel: 'Red', affectedCountries: ['Italy'] } } },
      ],
      edges: [],
      provenance: [],
    });
    expect(store.mapData({ from: '2026-10-01T00:00:00.000Z' }).affected.map((c) => c.country)).toEqual(['France', 'Spain']);
    expect(store.mapData({ types: ['article', 'vulnerability'] }).affected).toEqual([]);
    expect(store.mapData({}).affected.map((c) => c.country)).toEqual(['Italy', 'France', 'Spain']);
  });
});
