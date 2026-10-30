import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ingest } from '../src/ingest.ts';
import { Store } from '../src/store.ts';
import { buildSnapshot } from '../src/snapshot.ts';
import { RateLimiter, HttpError, type fetchJson } from '../src/http.ts';
import { indexSnapshot, queryFeed, queryGraph, queryMap, queryNode, queryTimeline, type Snapshot } from '../../web/src/staticApi.ts';
import type { TimedType } from '../../web/src/api.ts';
import { vi } from 'vitest';

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const fakeFetch = (async (url: string) => {
  const host = new URL(url).host;
  const map: Record<string, string> = {
    'www.cisa.gov': 'kev.json', 'api.first.org': 'epss.json', 'earthquake.usgs.gov': 'usgs.json',
    'eonet.gsfc.nasa.gov': 'eonet.json', 'hn.algolia.com': 'hn.json', 'api.gdeltproject.org': 'gdelt.json',
  };
  if (host === 'services.nvd.nist.gov') return url.includes('hasKev') ? fixture('nvd.json') : { ...fixture('nvd.json'), vulnerabilities: [], totalResults: 0 };
  if (map[host]) return fixture(map[host]);
  throw new HttpError(404, url);
}) as typeof fetchJson;

/** The static (GitHub Pages) engine must answer exactly like the SQL-backed server. */
describe('static snapshot engine parity', () => {
  const store = new Store();
  let ix: ReturnType<typeof indexSnapshot>;

  beforeAll(async () => {
    vi.spyOn(RateLimiter.prototype, 'acquire').mockResolvedValue();
    await ingest(store, { ctx: { fetchJson: fakeFetch, fetchText: (async () => readFileSync(new URL('./fixtures/atom-cccs.xml', import.meta.url), 'utf8')) as never, env: {}, log: () => {}, now: () => new Date('2026-10-30T20:00:00Z') } });
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

  it('pages the feed identically', () => {
    for (const f of cases) {
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
    }
    const tq = { types: all, from: '2026-09-01T00:00:00.000Z', to: '2026-11-01T00:00:00.000Z' };
    expect(queryTimeline(ix, tq, 61).series).toEqual(store.timeline({ ...tq, buckets: 61 }).series);
  });

  it('returns identical node details and graphs', () => {
    for (const id of ['cve:CVE-2021-44228', 'vendor:ivanti', 'cve:CVE-2026-111357']) {
      const st = queryNode(ix, id);
      expect(st.node.id).toBe(id);
      expect(st.provenance.map((p) => p.id)).toEqual(store.provenanceFor(id).map((p) => p.id));
      expect(st.edges.map((e) => `${e.src}|${e.dst}|${e.rel}|${e.basis}`).sort()).toEqual(
        store.edgesOf(id).map((e) => `${e.src}|${e.dst}|${e.rel}|${e.basis}`).sort(),
      );
      for (const depth of [1, 2]) {
        const g = store.graph(id, depth, 8);
        const sg = queryGraph(ix, id, depth, 8);
        expect(ids(sg.nodes).sort()).toEqual(ids(g.nodes).sort());
        expect(sg.edges.map((e) => `${e.src}|${e.dst}|${e.rel}`).sort()).toEqual(g.edges.map((e) => `${e.src}|${e.dst}|${e.rel}`).sort());
      }
    }
    expect(() => queryNode(ix, 'missing')).toThrow(/404/);
  });
});
