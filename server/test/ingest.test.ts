import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { ingest, SOURCES } from '../src/ingest.ts';
import { Store } from '../src/store.ts';
import { fetchJson, HttpError, RateLimiter } from '../src/http.ts';
import type { SourceModule } from '../src/sources/common.ts';

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

/** Routes each source URL to its recorded fixture, so the whole pipeline runs offline. */
const fakeFetch = (async (url: string) => {
  const u = new URL(url);
  if (u.host === 'www.cisa.gov') return fixture('kev.json');
  if (u.host === 'services.nvd.nist.gov') return u.search.includes('hasKev') ? fixture('nvd.json') : { ...fixture('nvd.json'), vulnerabilities: [], totalResults: 0 };
  if (u.host === 'api.first.org') return fixture('epss.json');
  if (u.host === 'earthquake.usgs.gov') return fixture('usgs.json');
  if (u.host === 'eonet.gsfc.nasa.gov') return fixture('eonet.json');
  if (u.host === 'api.gdeltproject.org') throw new HttpError(429, 'HTTP 429 from api.gdeltproject.org');
  if (u.host === 'hn.algolia.com') return fixture('hn.json');
  throw new Error(`unexpected ${url}`);
}) as typeof fetchJson;

describe('ingest pipeline', () => {
  it('runs all sources offline, isolates failures and records status', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const store = new Store();
    const logs: string[] = [];
    // Speed up rate limiters: the pipeline must not depend on wall-clock sleeps in tests.
    vi.spyOn(RateLimiter.prototype, 'acquire').mockResolvedValue();
    const { results, inferredEdges } = await ingest(store, {
      ctx: { fetchJson: fakeFetch, env: {}, log: (m) => logs.push(m), now: () => new Date('2026-10-30T20:00:00Z') },
    });
    vi.useRealTimers();
    vi.restoreAllMocks();

    expect(results.map((r) => [r.source, r.status])).toEqual(SOURCES.map((s) => [s.meta.id, s.meta.id === 'gdelt' ? 'error' : 'ok']));
    const gdelt = store.sources().find((s) => s.id === 'gdelt')!;
    expect(gdelt.lastError).toContain('429');

    const log4j = store.getNode('cve:CVE-2021-44228')!;
    // KEV facts, NVD CVSS and EPSS score merged onto one node with three provenance records.
    expect(log4j.attrs).toHaveProperty('kev');
    expect(log4j.attrs).toHaveProperty('cvss.score', 10);
    expect(log4j.attrs).toHaveProperty('epss.score');
    expect(log4j.title).toContain('Log4j');
    expect(log4j.severity).toBe(1);
    expect(store.provenanceFor(log4j.id).map((p) => p.id).sort()).toEqual(['cisa-kev', 'first-epss', 'nvd']);

    // Vulnerabilities are never geolocated; natural events are.
    expect(store.mapData({}).points.every((p) => p.type === 'natural_event')).toBe(true);
    expect(store.mapData({}).points.length).toBeGreaterThan(0);
    expect(inferredEdges).toBeGreaterThan(0); // KEV description of the Ivanti CVE references other CVEs
  });

  it('only runs the selected sources', async () => {
    const store = new Store();
    const ran: string[] = [];
    const mk = (id: string): SourceModule => ({
      meta: { id, name: id, homepage: 'h', description: 'd' },
      run: async () => { ran.push(id); return { nodes: [], edges: [], provenance: [] }; },
    });
    await ingest(store, { sources: [mk('a'), mk('b')], only: ['b'], ctx: { log: () => {} } });
    expect(ran).toEqual(['b']);
  });
});

describe('http helpers', () => {
  const response = (status: number, body: string, headers: Record<string, string> = {}) => new Response(body, { status, headers });

  it('retries 429/5xx with backoff, then succeeds', async () => {
    const sleeps: number[] = [];
    const impl = vi.fn()
      .mockResolvedValueOnce(response(429, 'slow down', { 'retry-after': '3' }))
      .mockResolvedValueOnce(response(503, 'busy'))
      .mockResolvedValueOnce(response(200, '{"ok":true}'));
    const out = await fetchJson('https://x.test/a', { fetchImpl: impl, sleep: async (ms) => { sleeps.push(ms); }, retries: 2 });
    expect(out).toEqual({ ok: true });
    expect(sleeps).toEqual([3000, 4000]);
  });

  it('does not retry client errors and reports invalid JSON', async () => {
    const impl = vi.fn().mockResolvedValue(response(404, 'nope'));
    await expect(fetchJson('https://x.test/a', { fetchImpl: impl, sleep: async () => {} })).rejects.toMatchObject({ status: 404 });
    expect(impl).toHaveBeenCalledTimes(1);
    const html = vi.fn().mockResolvedValue(response(200, '<html>'));
    await expect(fetchJson('https://x.test/a', { fetchImpl: html })).rejects.toThrow(/Invalid JSON/);
  });

  it('rate limiter waits once the window is full', async () => {
    let t = 0;
    const waits: number[] = [];
    const rl = new RateLimiter(2, 1000, () => t, async (ms) => { waits.push(ms); t += ms; });
    await rl.acquire();
    await rl.acquire();
    await rl.acquire();
    expect(waits).toEqual([1001]);
  });
});
