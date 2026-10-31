import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { ghsaSource, nextLink, parseGhsa } from '../src/sources/ghsa.ts';
import { extractGhsas } from '../src/relate.ts';
import { Store } from '../src/store.ts';
import type { IngestContext } from '../src/sources/common.ts';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/ghsa.json', import.meta.url), 'utf8'));

describe('GitHub Security Advisories parser (recorded response)', () => {
  it('creates ghsa: nodes for advisories without a CVE, with packages and CWEs', () => {
    const b = parseGhsa(fixture, new Set());
    const signalk = b.nodes.find((n) => n.id === 'ghsa:GHSA-4XM8-RG9H-JHQ2')!;
    expect(signalk).toMatchObject({ type: 'vulnerability', category: 'ghsa', url: 'https://github.com/advisories/GHSA-4xm8-rg9h-jhq2' });
    expect(signalk.attrs).toMatchObject({ cvss: { score: 9.8, source: 'GitHub' }, ghsa: { severity: 'critical' } });
    expect(b.edges).toContainEqual(expect.objectContaining({ src: signalk.id, dst: 'package:npm/signalk-server', rel: 'affects', basis: 'reported' }));
    expect(b.nodes.find((n) => n.id === 'package:npm/signalk-server')).toMatchObject({ type: 'product', title: 'signalk-server (npm)' });
    expect(b.edges).toContainEqual(expect.objectContaining({ src: signalk.id, dst: 'cwe:CWE-22', rel: 'has_weakness' }));
  });

  it('attaches to an existing CVE without replacing its title or CVSS', () => {
    const b = parseGhsa(fixture, new Set(['cve:CVE-2026-117601']));
    const cve = b.nodes.find((n) => n.id === 'cve:CVE-2026-117601')!;
    expect(cve).toMatchObject({ title: '' });
    expect(cve.attrs).toEqual({ ghsa: expect.objectContaining({ id: 'GHSA-6jp4-8v48-cc5v' }) });
  });

  it('creates the CVE node when the store does not have it yet', () => {
    const b = parseGhsa(fixture, new Set());
    expect(b.nodes.find((n) => n.id === 'cve:CVE-2026-117601')).toMatchObject({ category: 'cve', attrs: { cveId: 'CVE-2026-117601' } });
  });

  it('skips withdrawn advisories', () => {
    expect(parseGhsa([{ ...fixture[0], withdrawn_at: '2026-10-31T00:00:00Z' }], new Set()).nodes).toEqual([]);
  });

  it('extracts GHSA identifiers from text and follows Link pagination', () => {
    expect(extractGhsas('see GHSA-4XM8-RG9H-JHQ2 and ghsa-4xm8-rg9h-jhq2')).toEqual(['GHSA-4xm8-rg9h-jhq2']);
    expect(extractGhsas('GHSA-aaaa-bbbb-cccc')).toEqual([]); // not GitHub's alphabet
    expect(nextLink('<https://api.github.com/advisories?after=x>; rel="next", <…>; rel="prev"')).toBe('https://api.github.com/advisories?after=x');
    expect(nextLink(null)).toBeNull();
  });

  it('queries reviewed high and critical advisories, with the token when available', async () => {
    const fetchJsonWithHeaders = vi.fn().mockResolvedValue({ body: fixture, headers: new Headers() });
    const ctx = {
      store: new Store(), fetchJson: vi.fn(), fetchText: vi.fn(), fetchJsonWithHeaders, env: { GITHUB_TOKEN: 't0k' },
      now: () => new Date('2026-10-31T00:00:00Z'), log: () => {},
    } as unknown as IngestContext;
    const b = await ghsaSource.run(ctx);
    expect(fetchJsonWithHeaders).toHaveBeenCalledTimes(2);
    const [url, opts] = fetchJsonWithHeaders.mock.calls[0]!;
    expect(url).toContain('type=reviewed');
    expect(url).toContain('severity=critical');
    expect(opts.headers.authorization).toBe('Bearer t0k');
    expect(b.nodes.length).toBeGreaterThan(0);
  });
});
