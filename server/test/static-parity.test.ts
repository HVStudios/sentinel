import { beforeAll, describe, expect, it } from 'vitest';
import { ingest } from '../src/ingest.ts';
import { Store } from '../src/store.ts';
import { buildSnapshot } from '../src/snapshot.ts';
import { RateLimiter } from '../src/http.ts';
import { edgeOther } from '../../shared/coverage.ts';
import { vendorHqsFor } from '../../shared/vendorHq.ts';
import { indexSnapshot, queryFeed, queryGraph, queryMap, queryNode, queryRelated, queryStories, queryTimeline, queryTrends, type Snapshot } from '../../web/src/staticApi.ts';
import type { TimedType } from '../../web/src/api.ts';
import { vi } from 'vitest';

import { fixtureFetchJson as fakeFetch, fixtureFetchJsonWithHeaders, fixtureFetchText } from './fixtures/router.ts';

/** The static (GitHub Pages) engine must answer exactly like the SQL-backed server. */
describe('static snapshot engine parity', () => {
  const store = new Store();
  let ix: ReturnType<typeof indexSnapshot>;

  beforeAll(async () => {
    vi.spyOn(RateLimiter.prototype, 'acquire').mockResolvedValue();
    await ingest(store, { ctx: { fetchJson: fakeFetch, fetchText: fixtureFetchText, fetchJsonWithHeaders: fixtureFetchJsonWithHeaders, env: {}, log: () => {}, now: () => new Date('2026-10-30T20:00:00Z') } });
    vi.restoreAllMocks();
    // Round-trip through JSON exactly like the deployed snapshot file.
    ix = indexSnapshot(JSON.parse(JSON.stringify(buildSnapshot(store))) as Snapshot);
  });

  const ids = (xs: { id: string }[]) => xs.map((x) => x.id);
  const all: TimedType[] = ['vulnerability', 'natural_event', 'article'];
  const cases = [
    { types: all },
    { types: ['natural_event'] as TimedType[] },
    { types: all, from: '2026-01-01T00:00:00.000Z' },
    { types: all, q: 'ivanti' },
    { types: all, q: 'cve-2021' },
    { types: ['article', 'vulnerability'] as TimedType[], from: '2020-01-01T00:00:00.000Z', to: '2026-10-29T00:00:00.000Z' },
  ];

  it('pages the feed identically in every ordering', () => {
    for (const f of cases.flatMap((c) => (['latest', 'mixed', 'top'] as const).map((sort) => ({ ...c, sort })))) {
      let srvCursor: string | undefined;
      let staticCursor: string | undefined;
      for (let page = 0; page < 4; page++) {
        const srv = store.feed({ ...f, limit: 7, before: srvCursor });
        const st = queryFeed(ix, f, staticCursor, 7);
        expect(ids(st.items), JSON.stringify(f)).toEqual(ids(srv.items));
        expect(st.nextCursor).toEqual(srv.nextCursor);
        if (!srv.nextCursor) break;
        srvCursor = srv.nextCursor;
        staticCursor = st.nextCursor!;
      }
    }
  });

  it('returns identical map data and timelines', () => {
    for (const f of cases) {
      const srv = store.mapData(f);
      const st = queryMap(ix, f);
      expect(ids(st.points)).toEqual(ids(srv.points));
      expect(st.countries).toEqual(srv.countries);
      expect(st.vendors).toEqual(srv.vendors);
      expect(st.affected).toEqual(srv.affected);
    }
    // The fixtures include GDACS events with affected countries, so that layer is exercised too.
    expect(store.mapData({ types: all, from: '2026-01-01T00:00:00.000Z' }).affected.length).toBeGreaterThan(0);
    // The fixtures include Wikidata matches, so the vendor layer is actually exercised.
    expect(store.mapData({ types: all }).vendors.length).toBeGreaterThan(0);
    const tq = { types: all, from: '2026-09-01T00:00:00.000Z', to: '2026-11-01T00:00:00.000Z' };
    expect(queryTimeline(ix, tq, 61).series).toEqual(store.timeline({ ...tq, buckets: 61 }).series);
  });

  it('finds identical related items for watched nodes', () => {
    const ids_ = ['vendor:ivanti', 'product:ivanti/connect-secure', 'cve:CVE-2026-111357', ...store.stories({}).map((s) => s.id)];
    for (const id of ids_) {
      const srv = store.related(id).map((r) => `${r.node.id}|${r.via}`);
      expect(queryRelated(ix, id).map((r) => `${r.node.id}|${r.via}`), id).toEqual(srv);
    }
    expect(store.related('vendor:ivanti').length).toBeGreaterThan(0);
  });

  it('computes identical trends', () => {
    const now = new Date('2026-10-31T00:00:00Z');
    for (const w of [30, 90, 365]) expect(queryTrends(ix, now, w)).toEqual(store.trends(now, w));
    expect(store.trends(now, 365).kevInWindow).toBeGreaterThan(0);
    expect(store.trends(now, 30).epssMovers[0]!.movers.map((m) => m.id)).toContain('cve:CVE-2026-111357');
  });

  it('lists identical stories', () => {
    for (const f of [{}, { from: '2026-10-29T00:00:00.000Z' }, { to: '2026-10-29T00:00:00.000Z' }]) {
      expect(ids(queryStories(ix, f))).toEqual(ids(store.stories({ ...f, limit: 100 })));
    }
  });

  it('returns identical node details and graphs', () => {
    for (const id of ['cve:CVE-2021-44228', 'vendor:ivanti', 'cve:CVE-2026-111357']) {
      const st = queryNode(ix, id);
      expect(st.node.id).toBe(id);
      expect(st.provenance.map((p) => p.id)).toEqual(store.provenanceFor(id).map((p) => p.id));
      expect(st.edges.map((e) => `${e.src}|${e.dst}|${e.rel}|${e.basis}`).sort()).toEqual(
        store.edgesOf(id).map((e) => `${e.src}|${e.dst}|${e.rel}|${e.basis}`).sort(),
      );
      // The linked nodes' details (publisher country, outlet) match what the server API returns.
      for (const e of st.edges) expect(e.other, e.other.id).toEqual(edgeOther(store.getNode(e.other.id), e.other.id));
      // Vendor HQs for selection lines, followed through the same reported links.
      expect(st.vendorHqs, id).toEqual(vendorHqsFor({ node: (x) => store.getNode(x), edges: (x) => store.edgesOf(x) }, id));
      for (const depth of [1, 2]) {
        const g = store.graph(id, depth, 8);
        const sg = queryGraph(ix, id, depth, 8);
        expect(ids(sg.nodes).sort()).toEqual(ids(g.nodes).sort());
        expect(sg.edges.map((e) => `${e.src}|${e.dst}|${e.rel}`).sort()).toEqual(g.edges.map((e) => `${e.src}|${e.dst}|${e.rel}`).sort());
      }
    }
    // The fixtures link these to a Wikidata-matched vendor, so the HQ lines are actually exercised.
    for (const id of ['cve:CVE-2026-111357', 'vendor:ivanti', 'product:ivanti/connect-secure']) expect(queryNode(ix, id).vendorHqs.map((v) => v.id), id).toContain('vendor:ivanti');
    expect(() => queryNode(ix, 'missing')).toThrow(/404/);
  });
});
