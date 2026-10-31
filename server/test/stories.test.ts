import { describe, expect, it } from 'vitest';
import { clusterStories, findLinks, headlineTokens, runStories, weightedOverlap } from '../src/stories.ts';
import { Store, type EdgeRow, type NodeRow } from '../src/store.ts';

const T = (d: number, h = 12) => `2026-10-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:00:00.000Z`;
const node = (o: Partial<NodeRow> & Pick<NodeRow, 'id' | 'type' | 'title'>): NodeRow => ({ ingestedAt: 'x', attrs: {}, occurredAt: T(30), ...o }) as NodeRow;
const edge = (src: string, dst: string, rel: string, basis: 'reported' | 'inferred' = 'inferred', confidence = 0.95): EdgeRow =>
  ({ src, dst, rel, basis, confidence, sourceId: 's', observedAt: 'x', rationale: null }) as EdgeRow;
const kev = (id: string, product: string, day: number, sev = 0.9) =>
  node({ id, type: 'vulnerability', title: `${product} bug ${id}`, occurredAt: T(day), severity: sev, attrs: { cveId: id.slice(4), kev: { vendorProject: 'Acme', product } } });
const article = (id: string, title: string, o: Partial<NodeRow> = {}) => node({ id, type: 'article', title, category: 'security-news', attrs: { outlet: id }, ...o });

describe('story links', () => {
  it('links articles to the single CVE they mention', () => {
    const items = [kev('cve:CVE-1', 'Router', 30), article('news:a', 'Router flaw exploited')];
    const links = findLinks(items, [edge('news:a', 'cve:CVE-1', 'mentions')], new Map());
    expect(links).toEqual([expect.objectContaining({ kind: 'mention', reason: 'An article in this story mentions CVE-1.' })]);
  });

  it('ignores roundups mentioning unrelated vulnerabilities, but keeps coherent multi-CVE articles', () => {
    const items = [kev('cve:CVE-1', 'Router', 30), kev('cve:CVE-2', 'Mailer', 30), kev('cve:CVE-3', 'Router', 29), article('news:roundup', 'CISA adds two known exploited vulnerabilities'), article('news:router', 'Two router bugs')];
    const links = findLinks(
      items,
      [edge('news:roundup', 'cve:CVE-1', 'mentions'), edge('news:roundup', 'cve:CVE-2', 'mentions'), edge('news:router', 'cve:CVE-1', 'mentions'), edge('news:router', 'cve:CVE-3', 'mentions')],
      new Map(),
    );
    expect(links.filter((l) => l.a === 'news:roundup')).toEqual([]);
    expect(links.filter((l) => l.a === 'news:router').map((l) => l.b).sort()).toEqual(['cve:CVE-1', 'cve:CVE-3']);
  });

  it("links KEV CVEs in KEV's own product within 7 days, not via platform products or generic names", () => {
    const items = [kev('cve:A', 'Plex Media Server', 20), kev('cve:B', 'Plex Media Server', 22), kev('cve:C', 'Plex Media Server', 30), kev('cve:D', 'Multiple Products', 20), kev('cve:E', 'Multiple Products', 20)];
    const links = findLinks(items, [edge('cve:A', 'product:debian/debian-linux', 'affects', 'reported', 1), edge('cve:D', 'product:debian/debian-linux', 'affects', 'reported', 1)], new Map());
    expect(links.map((l) => `${l.a}-${l.b}:${l.kind}`)).toEqual(['cve:A-cve:B:product']);
  });

  it('links CVE references (exploit chains)', () => {
    const items = [kev('cve:CVE-1', 'X', 30), kev('cve:CVE-2', 'Y', 10)];
    expect(findLinks(items, [edge('cve:CVE-1', 'cve:CVE-2', 'references', 'inferred', 0.9)], new Map())[0]).toMatchObject({ kind: 'reference' });
  });

  it('links news headlines by shared distinctive words, never advisory templates', () => {
    const filler = Array.from({ length: 12 }, (_, i) => article(`news:f${i}`, `Unrelated story number ${['alpha', 'beta', 'gamma', 'delta', 'omega', 'sigma', 'kappa', 'theta', 'zeta', 'lambda', 'rho', 'tau'][i]} about hack attacks today`, { occurredAt: T(29) }));
    const items = [
      ...filler,
      article('news:b1', 'Crypto giant Binance hit by record hack, North Korea suspected', { occurredAt: T(30, 8) }),
      article('news:b2', 'Binance record hack bears hallmarks of North Korea', { occurredAt: T(30, 14) }),
      article('news:adv1', 'Siemens security advisory (AV26-1083)', { category: 'advisory' }),
      article('news:adv2', 'Siemens security advisory (AV26-1085)', { category: 'advisory' }),
    ];
    const links = findLinks(items, [], new Map()).filter((l) => l.kind === 'headline');
    expect(links.map((l) => [l.a, l.b])).toEqual([['news:b1', 'news:b2']]);
    expect(links[0]!.reason).toMatch(/^Headlines within 48 hours share distinctive words: .*binance/);
  });

  it('weights rare words over common ones', () => {
    const weight = (t: string) => (t === 'hack' ? 0.1 : 2);
    const { score, shared } = weightedOverlap(new Set(['binance', 'hack', 'record']), new Set(['binance', 'hack', 'korea']), weight);
    expect(shared).toEqual(['binance', 'hack']);
    expect(score).toBeCloseTo(2.1 / 6.1, 3);
    expect([...headlineTokens('Patch 2026 for CVE-2026-1 and AV26-1083 in the router')]).toEqual(['patch', 'router']);
  });
});

describe('clustering', () => {
  it('builds stories with stable ids, a readable lead title and explained members', () => {
    const items = [kev('cve:CVE-1', 'Router', 29), kev('cve:CVE-2', 'Router', 30), article('news:a', 'Router flaw exploited in the wild', { severity: 0.5 }), kev('cve:LONE', 'Other', 30)];
    const links = findLinks(items, [edge('news:a', 'cve:CVE-2', 'mentions')], new Map([['product:acme/router', 'Acme Router']]));
    const [story, ...rest] = clusterStories(items, links);
    expect(rest).toEqual([]); // the unlinked CVE is not a story
    expect(story).toMatchObject({ title: 'Router flaw exploited in the wild', firstSeen: T(29), lastSeen: T(30), anchors: ['CVE-1', 'CVE-2'] });
    expect(story!.members.map((m) => [m.id, m.kind])).toEqual([['cve:CVE-1', 'product'], ['cve:CVE-2', 'mention'], ['news:a', 'mention']]);
    expect(clusterStories(items, links)[0]!.id).toBe(story!.id);
  });

  it('prefers an English news headline, then a KEV name, over foreign-language advisories', () => {
    const items = [kev('cve:CVE-1', 'PHP', 30, 0.99), article('news:fr', 'Multiples vulnérabilités dans PHP', { category: 'advisory', severity: 0.9, attrs: { language: 'fr' } })];
    const s = clusterStories(items, [{ a: 'news:fr', b: 'cve:CVE-1', kind: 'mention', reason: 'r' }]);
    expect(s[0]!.title).toBe('PHP bug cve:CVE-1');
  });
});

describe('runStories', () => {
  it('replaces story nodes, part_of edges and member hints on every run', () => {
    const store = new Store(':memory:', () => '2026-10-31T00:00:00.000Z');
    store.registerSource({ id: 's', name: 's', homepage: 'h', description: 'd' });
    store.writeBatch({
      nodes: [kev('cve:CVE-1', 'Router', 29), kev('cve:CVE-2', 'Router', 30), kev('cve:OLD', 'Router', 1)],
      edges: [],
      provenance: [],
    });
    const now = new Date('2026-10-31T00:00:00Z');
    expect(runStories(store, now)).toEqual({ stories: 1, members: 2 });
    const [story] = store.stories({});
    expect(story).toMatchObject({ type: 'story', occurredAt: T(30), attrs: { size: 2, outlets: ['CISA KEV'] } });
    expect(store.getNode('cve:CVE-1')!.attrs.story).toEqual({ id: story!.id, title: story!.title, size: 2 });
    expect(store.edgesOf(story!.id).every((e) => e.rel === 'part_of' && e.basis === 'inferred' && e.rationale)).toBe(true);
    expect(store.getNode('cve:OLD')!.attrs.story).toBeUndefined(); // outside the 30-day window

    // Remove the link (one CVE moves out of the window): the story and its hints disappear.
    store.db.prepare(`update nodes set occurred_at = '2026-09-01T00:00:00.000Z' where id = 'cve:CVE-1'`).run();
    expect(runStories(store, now)).toEqual({ stories: 0, members: 0 });
    expect(store.stories({})).toEqual([]);
    expect(store.getNode('cve:CVE-2')!.attrs.story).toBeUndefined();
    expect(store.counts().edges).toBe(0);
  });
});
