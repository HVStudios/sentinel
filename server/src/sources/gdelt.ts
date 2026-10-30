import { emptyBatch, type Batch } from '../types.ts';
import { RateLimiter } from '../http.ts';
import { sha1, type SourceModule } from './common.ts';

export const GDELT_API = 'https://api.gdeltproject.org/api/v2/doc/doc';

/** Topic queries. GDELT asks clients for at most one request every 5 seconds. */
export const GDELT_QUERIES: { category: string; query: string }[] = [
  { category: 'security-news', query: '(cyberattack OR ransomware OR "data breach" OR "zero-day" OR hackers) sourcelang:english' },
  { category: 'tech-news', query: '("artificial intelligence" OR "generative AI" OR semiconductor OR "large language model") sourcelang:english' },
];

interface GdeltArticle {
  url: string;
  title: string;
  seendate: string;
  domain: string;
  language: string;
  sourcecountry: string;
  socialimage?: string;
}

export interface GdeltResponse {
  articles?: GdeltArticle[];
}

const meta = {
  id: 'gdelt',
  name: 'GDELT Project DOC 2.0',
  homepage: 'https://www.gdeltproject.org/',
  description: 'Global online news monitoring. Country is the publishing outlet’s country, not the event location.',
};

/** `20260819T033000Z` → ISO-8601. */
export const parseSeenDate = (s: string): string | null => {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.000Z` : null;
};

export function parseGdelt(resp: GdeltResponse, category: string): Batch {
  const b = emptyBatch();
  for (const a of resp.articles ?? []) {
    const occurredAt = parseSeenDate(a.seendate);
    if (!a.url || !a.title || !occurredAt) continue;
    const id = `news:${sha1(a.url)}`;
    const country = a.sourcecountry?.trim() || null;
    b.nodes.push({
      id,
      type: 'article',
      title: a.title.trim(),
      url: a.url,
      category,
      occurredAt,
      publishedAt: occurredAt,
      country,
      geoBasis: country ? 'publisher_country' : null,
      attrs: { domain: a.domain, language: a.language, publisherCountry: country, seenDate: occurredAt },
    });
    b.provenance.push({ nodeId: id, sourceId: meta.id, sourceUrl: a.url });
  }
  return b;
}

export const gdeltSource: SourceModule = {
  meta,
  async run(ctx) {
    const limiter = new RateLimiter(1, 6_000);
    const out = emptyBatch();
    const errors: string[] = [];
    for (const { category, query } of GDELT_QUERIES) {
      await limiter.acquire();
      const qs = new URLSearchParams({ query, mode: 'artlist', format: 'json', maxrecords: '75', sort: 'datedesc', timespan: '3d' });
      try {
        const part = parseGdelt(await ctx.fetchJson<GdeltResponse>(`${GDELT_API}?${qs}`, { timeoutMs: 45_000, retries: 1 }), category);
        out.nodes.push(...part.nodes);
        out.provenance.push(...part.provenance);
      } catch (err) {
        errors.push(`${category}: ${(err as Error).message}`);
      }
    }
    if (errors.length === GDELT_QUERIES.length) throw new Error(errors.join('; '));
    for (const e of errors) ctx.log(`gdelt: ${e}`);
    return out;
  },
};
