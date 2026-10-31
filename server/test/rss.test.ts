import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseFeed, parseFeedXml, plainText, rssSource } from '../src/sources/rss.ts';
import { FEEDS, type FeedConfig } from '../src/sources/feeds.ts';
import { Store } from '../src/store.ts';
import type { IngestContext } from '../src/sources/common.ts';
import { HttpError } from '../src/http.ts';

const xml = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const feed = (over: Partial<FeedConfig> = {}): FeedConfig => ({ ...FEEDS[0]!, ...over });
const NOW = new Date('2026-10-31T00:00:00Z');

describe('feed XML parsing', () => {
  it('reads RSS 2.0 items with titles, links, dates and plain-text summaries', () => {
    const items = parseFeedXml(xml('rss-bleepingcomputer.xml'));
    expect(items).toHaveLength(3);
    for (const i of items) {
      expect(i.link).toMatch(/^https:\/\/www\.bleepingcomputer\.com\//);
      expect(i.published).toMatch(/^2026-10-30T/);
      expect(i.summary).not.toMatch(/<[a-z]/i);
    }
  });

  it('reads Atom entries, including CDATA titles and alternate links', () => {
    const cccs = parseFeedXml(xml('atom-cccs.xml'));
    expect(cccs.length).toBeGreaterThan(0);
    expect(cccs[0]!.title).toMatch(/advisory/i);
    expect(cccs[0]!.link).toMatch(/^https:\/\/cyber\.gc\.ca\/en\/alerts-advisories\//);
    const heise = parseFeedXml(xml('atom-heise.xml'));
    expect(heise).toHaveLength(2);
    expect(heise[0]!.link).toMatch(/^https:\/\/www\.heise\.de\//);
  });

  it('drops items without a date or link instead of guessing', () => {
    const items = parseFeedXml(`<rss><channel>
      <item><title>No date</title><link>https://example.org/a</link></item>
      <item><title>No link</title><pubDate>Fri, 30 Oct 2026 10:00:00 GMT</pubDate></item>
      <item><title>Two-digit year</title><link>https://example.org/b</link><pubDate>Fri, 30 Oct 26 12:00:00 +0000</pubDate></item>
    </channel></rss>`);
    expect(items).toEqual([{ title: 'Two-digit year', link: 'https://example.org/b', published: '2026-10-30T12:00:00.000Z', summary: '' }]);
  });

  it('strips HTML and decodes entities', () => {
    expect(plainText('<p>Patch &amp; pray &#8211; <b>now</b>&nbsp;&#x2014;<script>x()</script></p>')).toBe('Patch & pray – now —');
  });
});

describe('feed → nodes', () => {
  it('attaches the configured publisher country, never an event location', () => {
    const b = parseFeed(xml('atom-cccs.xml'), feed({ id: 'cccs', name: 'CCCS', country: 'Canada', category: 'advisory', countryRef: 'https://ref' }), NOW);
    expect(b.nodes.length).toBeGreaterThan(0);
    const n = b.nodes[0]!;
    expect(n).toMatchObject({ type: 'article', category: 'advisory', country: 'Canada', geoBasis: 'publisher_country' });
    expect(n.lat ?? null).toBeNull();
    expect(n.attrs).toMatchObject({ outlet: 'CCCS', publisherCountryRef: 'https://ref' });
    expect(n.id).toMatch(/^news:[0-9a-f]{16}$/);
    expect(b.provenance).toHaveLength(b.nodes.length);
  });

  it('classifies tech-feed items by headline but keeps advisory categories', () => {
    const doc = (title: string) => `<rss><channel><item><title>${title}</title><link>https://example.org/${encodeURIComponent(title)}</link><pubDate>Fri, 30 Oct 2026 10:00:00 GMT</pubDate></item></channel></rss>`;
    const cat = (title: string, category: FeedConfig['category']) => parseFeed(doc(title), feed({ category }), NOW).nodes[0]!.category;
    expect(cat('Intel stock falls', 'ai')).toBe('tech-news');
    expect(cat('New LLM beats benchmarks', 'tech-news')).toBe('ai');
    expect(cat('Ransomware hits hospital', 'tech-news')).toBe('security-news');
    expect(cat('Quarterly update', 'advisory')).toBe('advisory');
  });

  it('drops sponsored posts', () => {
    const doc = `<rss><channel><item><title>Anzeige: Monitor zum Bestpreis</title><link>https://example.org/ad</link><pubDate>Fri, 30 Oct 2026 10:00:00 GMT</pubDate></item></channel></rss>`;
    expect(parseFeed(doc, feed(), NOW).nodes).toEqual([]);
  });

  it('skips items older than 30 days or dated in the future', () => {
    expect(parseFeed(xml('rss-bleepingcomputer.xml'), feed(), new Date('2027-01-01T00:00:00Z')).nodes).toHaveLength(0);
    expect(parseFeed(xml('rss-bleepingcomputer.xml'), feed(), new Date('2026-10-01T00:00:00Z')).nodes).toHaveLength(0);
  });
});

describe('feed registry', () => {
  it('has unique ids, https URLs, a country reference and a category for every feed', () => {
    expect(new Set(FEEDS.map((f) => f.id)).size).toBe(FEEDS.length);
    for (const f of FEEDS) {
      expect(f.url).toMatch(/^https:\/\//);
      expect(f.countryRef).toMatch(/^https:\/\//);
      expect(f.country.length).toBeGreaterThan(2);
      expect(['security-news', 'advisory', 'tech-news', 'ai']).toContain(f.category);
    }
  });
});

describe('news feed source', () => {
  const ctx = (fetchText: IngestContext['fetchText']): IngestContext => ({
    store: new Store(), fetchJson: vi.fn(), fetchText, fetchJsonWithHeaders: vi.fn(), env: {}, now: () => NOW, log: () => {},
  });

  it('collects feeds and reports individual failures as warnings', async () => {
    const fetchText = vi.fn(async (url: string) => {
      if (url.includes('bleepingcomputer')) return xml('rss-bleepingcomputer.xml');
      throw new HttpError(503, `HTTP 503 from ${new URL(url).host}`);
    });
    const res = await rssSource.run(ctx(fetchText as IngestContext['fetchText']));
    expect(res.nodes).toHaveLength(3);
    expect(res.warnings).toHaveLength(FEEDS.length - 1);
    expect(fetchText).toHaveBeenCalledTimes(FEEDS.length);
  });

  it('fails only when every feed fails', async () => {
    await expect(rssSource.run(ctx((async () => { throw new Error('offline'); }) as IngestContext['fetchText']))).rejects.toThrow(/all feeds failed/);
  });
});
