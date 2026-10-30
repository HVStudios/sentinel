import { emptyBatch, type Batch } from '../types.ts';
import { type SourceModule } from './common.ts';

export const HN_API = 'https://hn.algolia.com/api/v1/search_by_date';
const MIN_POINTS = 100;

interface HnHit {
  objectID: string;
  title: string;
  url?: string | null;
  author: string;
  points: number | null;
  num_comments: number | null;
  created_at: string;
}

export interface HnResponse {
  hits: HnHit[];
}

const meta = {
  id: 'hacker-news',
  name: 'Hacker News (via Algolia)',
  homepage: 'https://news.ycombinator.com/',
  description: `Technology stories with at least ${MIN_POINTS} points. No geographic information.`,
};

const AI = /\b(AI|AGI|LLMs?|GPT[-\w]*|OpenAI|Anthropic|Claude|Gemini|DeepMind|Llama|Mistral|machine learning|neural|transformer|diffusion|chatbot|inference)\b/i;
const SECURITY =
  /\b(CVE-\d{4}-\d+|vulnerabilit(y|ies)|exploit(ed|s)?|zero-day|0-day|ransomware|malware|breach(ed)?|hack(ed|ers?)?|phishing|backdoor|botnet|RCE|security)\b/i;

export const classifyHn = (title: string): string =>
  SECURITY.test(title) ? 'security-news' : AI.test(title) ? 'ai' : 'tech';

export function parseHn(resp: HnResponse): Batch {
  const b = emptyBatch();
  for (const h of resp.hits) {
    if (!h.title) continue;
    const id = `hn:${h.objectID}`;
    const hnUrl = `https://news.ycombinator.com/item?id=${h.objectID}`;
    b.nodes.push({
      id,
      type: 'article',
      title: h.title,
      url: h.url || hnUrl,
      category: classifyHn(h.title),
      occurredAt: new Date(h.created_at).toISOString(),
      publishedAt: new Date(h.created_at).toISOString(),
      attrs: {
        hnUrl,
        points: h.points ?? 0,
        comments: h.num_comments ?? 0,
        author: h.author,
        domain: h.url ? new URL(h.url).hostname.replace(/^www\./, '') : 'news.ycombinator.com',
      },
    });
    b.provenance.push({ nodeId: id, sourceId: meta.id, sourceUrl: hnUrl });
  }
  return b;
}

export const hnSource: SourceModule = {
  meta,
  async run(ctx) {
    const since = Math.floor(ctx.now().getTime() / 1000) - 3 * 86_400;
    const qs = new URLSearchParams({
      tags: 'story',
      hitsPerPage: '200',
      numericFilters: `created_at_i>${since},points>${MIN_POINTS}`,
    });
    return parseHn(await ctx.fetchJson<HnResponse>(`${HN_API}?${qs}`));
  },
};
