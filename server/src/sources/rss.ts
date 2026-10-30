import { XMLParser } from 'fast-xml-parser';
import { emptyBatch, type Batch } from '../types.ts';
import { sha1, type SourceModule } from './common.ts';
import { FEEDS, type FeedConfig } from './feeds.ts';
import { classifyHn } from './hn.ts';

const MAX_ITEMS_PER_FEED = 40;
const MAX_AGE_DAYS = 30;
const SUMMARY_MAX = 400;
const CONCURRENCY = 4;

const meta = {
  id: 'news-feeds',
  name: 'Curated news and advisory feeds',
  homepage: 'https://github.com/HVStudios/sentinel/blob/main/server/src/sources/feeds.ts',
  description: `${FEEDS.length} RSS/Atom feeds. Country is the publisher's (configured per outlet with a reference), not the event location.`,
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  textNodeName: '#text',
  cdataPropName: false,
  processEntities: true,
  htmlEntities: true,
  // Elements that may repeat must always be arrays, even when a feed has one item.
  isArray: (name) => ['item', 'entry', 'link'].includes(name),
});

type XmlValue = string | number | { '#text'?: string | number; '@href'?: string; '@rel'?: string } | undefined;

const text = (v: XmlValue): string => {
  if (v == null) return '';
  if (typeof v === 'object') return String(v['#text'] ?? '');
  return String(v);
};

const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Plain text from feed HTML: tags removed, leftover entities decoded, whitespace collapsed. */
export const plainText = (html: string): string =>
  html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) =>
      e[0] === '#' ? String.fromCodePoint(e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENTITY[e.toLowerCase()] ?? m),
    )
    .replace(/\s+/g, ' ')
    .trim();

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export interface FeedItem {
  title: string;
  link: string;
  published: string;
  summary: string;
}

/** Extracts items from RSS 2.0 or Atom. Items without a title, link or parseable date are dropped, not guessed. */
export function parseFeedXml(xml: string): FeedItem[] {
  const doc = parser.parse(xml) as Record<string, any>;
  const rssItems: any[] = doc.rss?.channel?.item ?? doc['rdf:RDF']?.item ?? [];
  const atomEntries: any[] = doc.feed?.entry ?? [];
  const out: FeedItem[] = [];

  for (const it of rssItems) {
    const link = text(Array.isArray(it.link) ? it.link[0] : it.link) || (typeof it.guid === 'string' ? it.guid : text(it.guid));
    const date = Date.parse(text(it.pubDate) || text(it['dc:date']));
    out.push({ title: plainText(text(it.title)), link: link.trim(), published: Number.isNaN(date) ? '' : new Date(date).toISOString(), summary: plainText(text(it.description)) });
  }
  for (const e of atomEntries) {
    const links: any[] = e.link ?? [];
    const alt = links.find((l) => typeof l === 'object' && (!l['@rel'] || l['@rel'] === 'alternate')) ?? links[0];
    const link = typeof alt === 'object' ? (alt['@href'] ?? '') : text(alt);
    const date = Date.parse(text(e.published) || text(e.updated));
    out.push({ title: plainText(text(e.title)), link: String(link).trim(), published: Number.isNaN(date) ? '' : new Date(date).toISOString(), summary: plainText(text(e.summary) || text(e.content)) });
  }
  return out.filter((i) => i.title && /^https?:\/\//.test(i.link) && i.published);
}

export function parseFeed(xml: string, feed: FeedConfig, now: Date): Batch {
  const b = emptyBatch();
  const minDate = new Date(now.getTime() - MAX_AGE_DAYS * 86_400_000).toISOString();
  // Allow small clock skew, but never accept items dated in the future beyond a day.
  const maxDate = new Date(now.getTime() + 86_400_000).toISOString();
  const items = parseFeedXml(xml)
    .filter((i) => i.published >= minDate && i.published <= maxDate)
    .slice(0, MAX_ITEMS_PER_FEED);
  for (const it of items) {
    // Tech feeds mix topics, so classify by headline; security and advisory feeds keep their focus.
    const classified = classifyHn(it.title);
    const category =
      feed.category === 'tech-news' || feed.category === 'ai' ? (classified === 'tech' ? 'tech-news' : classified) : feed.category;
    // Same id scheme as GDELT, so an article seen by both is stored once.
    const id = `news:${sha1(it.link)}`;
    b.nodes.push({
      id,
      type: 'article',
      title: it.title,
      summary: it.summary ? truncate(it.summary, SUMMARY_MAX) : null,
      url: it.link,
      category,
      occurredAt: it.published,
      publishedAt: it.published,
      country: feed.country,
      geoBasis: 'publisher_country',
      attrs: {
        outlet: feed.name,
        outletId: feed.id,
        domain: new URL(it.link).hostname.replace(/^www\./, ''),
        language: feed.language,
        publisherCountry: feed.country,
        publisherCountryBasis: 'Outlet headquarters or issuing agency, configured in the SENTINEL feed registry',
        publisherCountryRef: feed.countryRef,
      },
    });
    b.provenance.push({ nodeId: id, sourceId: meta.id, sourceUrl: feed.url });
  }
  return b;
}

export const rssSource: SourceModule = {
  meta,
  async run(ctx) {
    const out = emptyBatch();
    const warnings: string[] = [];
    const queue = [...FEEDS];
    const worker = async () => {
      for (let feed = queue.shift(); feed; feed = queue.shift()) {
        try {
          const xml = await ctx.fetchText(feed.url, { accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8', retries: 1 });
          const part = parseFeed(xml, feed, ctx.now());
          out.nodes.push(...part.nodes);
          out.provenance.push(...part.provenance);
        } catch (err) {
          warnings.push(`${feed.id}: ${(err as Error).message}`);
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    if (warnings.length === FEEDS.length) throw new Error(`all feeds failed: ${warnings.join('; ')}`);
    return { ...out, warnings };
  },
};
