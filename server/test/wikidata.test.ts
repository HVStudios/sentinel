import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildQuery, parsePoint, resolveVendors, wikidataSource, type VendorWikidata, type WdqsResponse } from '../src/sources/wikidata.ts';
import { Store } from '../src/store.ts';
import { HttpError, RateLimiter } from '../src/http.ts';
import type { IngestContext } from '../src/sources/common.ts';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/wikidata.json', import.meta.url), 'utf8')) as WdqsResponse;
const NAMES = ['Apple', 'Oracle', 'Progress', 'Microsoft', 'Cisco', 'Ivanti', 'Siemens', 'Hikvision', 'Juniper', 'Linux'];
const AT = '2026-10-31T00:00:00.000Z';

describe('Wikidata vendor resolution (recorded response)', () => {
  const r = resolveVendors(NAMES, fixture, AT);

  it('rejects same-name organisations that are not technology companies', () => {
    expect(r.get('Apple')).toMatchObject({ status: 'matched', qid: 'Q312', label: 'Apple Inc.' }); // not Apple Records
    expect(r.get('Oracle')).toMatchObject({ qid: 'Q19900', label: 'Oracle Corporation' }); // not the Madrid "Oracle"
    expect(r.get('Progress')).toMatchObject({ label: 'Progress Software' });
  });

  it('records headquarters as reported, with match basis and confidence', () => {
    expect(r.get('Microsoft')).toMatchObject({
      matchedBy: 'exact label', confidence: 0.8, url: 'https://www.wikidata.org/wiki/Q2283',
      hq: { label: 'Redmond', country: 'United States' },
    });
    expect(r.get('Juniper')).toMatchObject({ label: 'Juniper Networks', matchedBy: 'name variant', confidence: 0.7 });
    expect(r.get('Oracle')).toMatchObject({ matchedBy: 'name variant', confidence: 0.7 }); // label "Oracle Corporation"
    const aliasOnly: WdqsResponse = { results: { bindings: [
      { name: { value: 'Facebook' }, item: { value: 'http://www.wikidata.org/entity/Q9' }, itemLabel: { value: 'Reality Labs' }, desc: { value: 'technology division' }, hqLabel: { value: 'Menlo Park' }, countryLabel: { value: 'United States' }, coord: { value: 'Point(-122.18 37.45)' } },
    ] } };
    expect(resolveVendors(['Facebook'], aliasOnly, AT).get('Facebook')).toMatchObject({ status: 'matched', label: 'Reality Labs', matchedBy: 'alias', confidence: 0.55 });
    const hq = r.get('Siemens')!.hq!;
    expect(hq.lat).toBeCloseTo(48.14, 1);
    expect(hq.lon).toBeCloseTo(11.58, 1);
  });

  it('breaks ties between duplicate items only when they share headquarters', () => {
    expect(r.get('Cisco')).toMatchObject({ status: 'matched', qid: 'Q173395' });
    const twoCountries: WdqsResponse = { results: { bindings: [
      { name: { value: 'Acme' }, item: { value: 'http://www.wikidata.org/entity/Q1' }, itemLabel: { value: 'Acme' }, desc: { value: 'software company' }, hqLabel: { value: 'Oslo' }, countryLabel: { value: 'Norway' } },
      { name: { value: 'Acme' }, item: { value: 'http://www.wikidata.org/entity/Q2' }, itemLabel: { value: 'Acme' }, desc: { value: 'software company' }, hqLabel: { value: 'Lima' }, countryLabel: { value: 'Peru' } },
    ] } };
    expect(resolveVendors(['Acme'], twoCountries, AT).get('Acme')).toMatchObject({ status: 'ambiguous', qid: null, hq: null, candidates: ['Q1', 'Q2'] });
  });

  it('reports no match without inventing one', () => {
    expect(r.get('Linux')).toMatchObject({ status: 'none', qid: null, hq: null, candidates: [] });
  });

  it('builds a query with every name variant, escaped', () => {
    const q = buildQuery(['Say "Hi"']);
    expect(q).toContain('"Say \\"Hi\\""@en');
    expect(q).toContain('"Say \\"Hi\\" Networks"@en');
    expect(q).not.toContain('Technologies');
    expect(q).toContain('wdt:P159');
  });

  it('parses WKT points and rejects anything else', () => {
    expect(parsePoint('Point(-122.12 47.67)')).toEqual({ lat: 47.67, lon: -122.12 });
    expect(parsePoint('Point(500 10)')).toBeNull();
    expect(parsePoint(undefined)).toBeNull();
  });
});

describe('Wikidata vendor source', () => {
  const setup = () => {
    const store = new Store(':memory:', () => AT);
    store.registerSource(wikidataSource.meta);
    store.writeBatch({ nodes: NAMES.map((n) => ({ id: `vendor:${n.toLowerCase()}`, type: 'vendor' as const, title: n })), edges: [], provenance: [] });
    return store;
  };
  const ctx = (store: Store, fetchJson: IngestContext['fetchJson']): IngestContext => ({
    store, fetchJson, fetchText: vi.fn(), env: {}, now: () => new Date(AT), log: () => {},
  });

  it('enriches vendors, adds provenance for matches, and skips recently checked vendors', async () => {
    vi.spyOn(RateLimiter.prototype, 'acquire').mockResolvedValue();
    const store = setup();
    const fetchJson = vi.fn().mockResolvedValue(fixture);
    const res = await wikidataSource.run(ctx(store, fetchJson as never));
    store.writeBatch(res);
    expect(fetchJson).toHaveBeenCalledWith('https://query.wikidata.org/sparql', expect.objectContaining({ method: 'POST' }));
    const ms = store.getNode('vendor:microsoft')!;
    expect(ms.title).toBe('Microsoft');
    expect((ms.attrs.wikidata as VendorWikidata).hq?.label).toBe('Redmond');
    expect(store.provenanceFor('vendor:microsoft')[0]).toMatchObject({ sourceUrl: 'https://www.wikidata.org/wiki/Q2283' });
    expect(store.provenanceFor('vendor:linux')).toEqual([]);

    // A second run within 30 days has nothing to look up.
    const again = await wikidataSource.run(ctx(store, fetchJson as never));
    expect(again.nodes).toHaveLength(0);
    vi.restoreAllMocks();
  });

  it('replaces an old match completely when a re-check finds none', () => {
    const store = setup();
    const matched = resolveVendors(['Microsoft'], fixture, AT).get('Microsoft')!;
    store.writeBatch({ nodes: [{ id: 'vendor:microsoft', type: 'vendor', title: '', attrs: { wikidata: matched } }], edges: [], provenance: [] });
    const none = resolveVendors(['Microsoft'], { results: { bindings: [] } }, AT).get('Microsoft')!;
    store.writeBatch({ nodes: [{ id: 'vendor:microsoft', type: 'vendor', title: '', attrs: { wikidata: none } }], edges: [], provenance: [] });
    expect(store.getNode('vendor:microsoft')!.attrs.wikidata).toEqual({ status: 'none', candidates: [], checkedAt: AT });
  });

  it('stops at the time budget, most-affected vendors first', async () => {
    vi.spyOn(RateLimiter.prototype, 'acquire').mockResolvedValue();
    const store = setup();
    store.writeBatch({
      nodes: [{ id: 'cve:CVE-1', type: 'vulnerability', title: 'x' }, { id: 'product:linux/kernel', type: 'product', title: 'Linux Kernel' }],
      edges: [
        { src: 'cve:CVE-1', dst: 'product:linux/kernel', rel: 'affects', basis: 'reported', confidence: 1, sourceId: 's' },
        { src: 'product:linux/kernel', dst: 'vendor:linux', rel: 'made_by', basis: 'reported', confidence: 1, sourceId: 's' },
      ],
      provenance: [],
    });
    const fetchJson = vi.fn().mockResolvedValue(fixture);
    const res = await wikidataSource.run({ ...ctx(store, fetchJson as never), env: { WIKIDATA_BUDGET_MS: '-1' } });
    expect(res.nodes).toHaveLength(0); // budget already spent: nothing looked up, nothing marked as checked
    const res2 = await wikidataSource.run({ ...ctx(store, fetchJson as never), env: { WIKIDATA_BUDGET_MS: '100000' } });
    expect(String(fetchJson.mock.calls[0]![1].form.query).indexOf('"Linux"')).toBeLessThan(String(fetchJson.mock.calls[0]![1].form.query).indexOf('"Apple"'));
    expect(res2.nodes).toHaveLength(NAMES.length);
    vi.restoreAllMocks();
  });

  it('skips a failing batch with a warning and leaves its vendors for the next run', async () => {
    vi.spyOn(RateLimiter.prototype, 'acquire').mockResolvedValue();
    const store = setup();
    const fetchJson = vi.fn().mockRejectedValueOnce(new HttpError(504, 'HTTP 504 from query.wikidata.org')).mockResolvedValue(fixture);
    // 10 vendors in one batch: the only request fails, so the whole run fails without marking anyone checked.
    await expect(wikidataSource.run(ctx(store, fetchJson as never))).rejects.toThrow(/all lookups failed/);
    expect(fetchJson).toHaveBeenCalledTimes(1); // no retries or splitting against a struggling service
    const res = await wikidataSource.run(ctx(store, fetchJson as never));
    expect(res.nodes).toHaveLength(NAMES.length);
    expect(res.warnings).toEqual([]);
    vi.restoreAllMocks();
  });
});
