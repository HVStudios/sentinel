import type { EdgeRow, NodeRow, Store } from './store.ts';
import type { SentinelEdge, SentinelNode, SourceMeta } from './types.ts';
import { productNodeId, sha1 } from './sources/common.ts';
import { packageNodeId } from './sources/ghsa.ts';

/**
 * Stories: clusters of related vulnerabilities and articles, built without an LLM from explicit,
 * explainable links. Two items join a story only through one of these:
 *  - mention:   an article mentions a CVE/GHSA identifier (inferred mention edge, confidence ≥ 0.9).
 *               An article mentioning several vulnerabilities links them only if they belong
 *               together (same product per KEV or GitHub); catalog roundups such as "CISA adds
 *               two known exploited vulnerabilities" would otherwise bridge unrelated stories;
 *  - reference: a CVE's description references another CVE (e.g. an exploit chain);
 *  - product:   two KEV-listed CVEs share KEV's own product within 7 days (NVD's CPE data also
 *               lists platforms such as Fedora or Debian, which would join unrelated bugs);
 *  - headline:  two news articles' headlines share at least 3 words and an IDF-weighted overlap of
 *               ≥ 0.3 within 48 hours (rare words count more than common ones).
 *    Advisory feeds are excluded: their titles are templates ("<Vendor> security advisory (AV26-…)",
 *    "Multiples vulnérabilités dans <product> (<date>)") that would chain unrelated advisories
 *    together; they join stories through the identifiers they mention instead.
 * Vendor-name mentions alone never join a story (everything about Microsoft is not one story).
 */

export const STORY_SOURCE: SourceMeta = {
  id: 'sentinel-stories',
  name: 'SENTINEL stories',
  homepage: 'https://github.com/HVStudios/sentinel/blob/main/docs/ARCHITECTURE.md#stories',
  description: 'Groups of related items, built by SENTINEL from explicit links (identifiers, exploit chains, shared products, headlines).',
};

export const WINDOW_DAYS = 30;
const PRODUCT_DAYS = 7;
const HEADLINE_HOURS = 48;
const HEADLINE_MIN_TOKENS = 4;
/** IDF-weighted overlap: shared rare words ("Binance", "Drupal") count far more than common ones ("hack"). */
const HEADLINE_SIMILARITY = 0.3;
const HEADLINE_MIN_SHARED = 3;

export type LinkKind = 'mention' | 'reference' | 'product' | 'headline';
export const LINK_CONFIDENCE: Record<LinkKind, number> = { mention: 0.9, reference: 0.9, product: 0.7, headline: 0.6 };

export interface StoryLink {
  a: string;
  b: string;
  kind: LinkKind;
  reason: string;
}

const STOPWORDS = new Set(
  ('the a an and or of to in on for with by from as at is are was were be been it its this that these those new over after amid into ' +
    'how why what who says said report reports update updates via about more than not now can could will would just your you our we').split(' '),
);

export const headlineTokens = (title: string): Set<string> =>
  new Set(
    title
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
      .split(/\s+/)
      // Numbers, years and advisory IDs say nothing about the topic.
      .filter((t) => t.length >= 3 && !STOPWORDS.has(t) && !/\d/.test(t)),
  );

/** Weighted Jaccard: Σ weight(shared) / Σ weight(union), plus the shared words by weight. */
export function weightedOverlap(a: Set<string>, b: Set<string>, weight: (t: string) => number): { score: number; shared: string[] } {
  let inter = 0;
  let union = 0;
  const shared: string[] = [];
  for (const t of new Set([...a, ...b])) {
    const w = weight(t);
    union += w;
    if (a.has(t) && b.has(t)) {
      inter += w;
      shared.push(t);
    }
  }
  return { score: union ? inter / union : 0, shared: shared.sort((x, y) => weight(y) - weight(x)) };
}

const hours = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 3_600_000;
const GENERIC_PRODUCT = /multiple[- ]products|^product:[^/]+\/(multiple|unknown|n-a)$/i;

/** Pure: the explainable links between timed items, given their edges. */
export function findLinks(items: NodeRow[], edges: EdgeRow[], productTitles: Map<string, string>): StoryLink[] {
  const byId = new Map(items.map((n) => [n.id, n]));
  const links: StoryLink[] = [];
  const label = (n: NodeRow) => (n.attrs.cveId as string | undefined) ?? (n.attrs.ghsa as { id?: string } | undefined)?.id ?? n.title;

  const affects = new Map<string, NodeRow[]>();
  // Products as named by the curated sources (KEV, GitHub), per vulnerability.
  const curatedProducts = new Map<string, Set<string>>();
  const mentionsBy = new Map<string, NodeRow[]>();
  for (const e of edges) {
    const src = byId.get(e.src);
    const dst = byId.get(e.dst);
    if (e.basis === 'inferred' && e.confidence >= 0.9 && src && dst) {
      if (e.rel === 'mentions' && src.type === 'article' && dst.type === 'vulnerability')
        mentionsBy.set(src.id, [...(mentionsBy.get(src.id) ?? []), dst]);
      else if (e.rel === 'references' && src.type === 'vulnerability' && dst.type === 'vulnerability')
        links.push({ a: src.id, b: dst.id, kind: 'reference', reason: `${label(src)} references ${label(dst)} (e.g. an exploit chain).` });
    }
  }
  // Products as named by the curated sources themselves: KEV's product field and GitHub's package
  // list (edge sources can't be used: an edge records only the last source that wrote it).
  for (const v of items) {
    if (v.type !== 'vulnerability') continue;
    const set = new Set<string>();
    const kev = v.attrs.kev as { vendorProject?: string; product?: string } | undefined;
    if (kev?.vendorProject && kev.product) {
      const pid = productNodeId(kev.vendorProject, kev.product);
      if (!GENERIC_PRODUCT.test(pid) && !GENERIC_PRODUCT.test(kev.product)) {
        set.add(pid);
        affects.set(pid, [...(affects.get(pid) ?? []), v]);
      }
    }
    for (const p of (v.attrs.ghsa as { packages?: { ecosystem: string; name: string }[] } | undefined)?.packages ?? []) set.add(packageNodeId(p.ecosystem, p.name));
    if (set.size) curatedProducts.set(v.id, set);
  }

  for (const [articleId, vulns] of mentionsBy) {
    const unique = [...new Map(vulns.map((v) => [v.id, v])).values()];
    const shared = unique.length > 1 ? [...(curatedProducts.get(unique[0]!.id) ?? [])].filter((p) => unique.every((v) => curatedProducts.get(v.id)?.has(p))) : [];
    if (unique.length > 1 && !shared.length) continue; // a roundup of unrelated vulnerabilities
    for (const v of unique) links.push({ a: articleId, b: v.id, kind: 'mention', reason: `An article in this story mentions ${label(v)}.` });
  }

  for (const [product, vulns] of affects) {
    const unique = [...new Map(vulns.map((v) => [v.id, v])).values()].sort((x, y) => x.occurredAt!.localeCompare(y.occurredAt!));
    for (let i = 1; i < unique.length; i++) {
      const prev = unique[i - 1]!;
      const cur = unique[i]!;
      if (hours(prev.occurredAt!, cur.occurredAt!) <= PRODUCT_DAYS * 24)
        links.push({ a: prev.id, b: cur.id, kind: 'product', reason: `Known-exploited vulnerabilities in ${productTitles.get(product) ?? (cur.attrs.kev as { product?: string }).product ?? product}, added within ${PRODUCT_DAYS} days of each other.` });
    }
  }

  const articles = items
    .filter((n) => n.type === 'article' && n.category !== 'advisory')
    .map((n) => ({ n, tokens: headlineTokens(n.title) }))
    .filter((x) => x.tokens.size >= HEADLINE_MIN_TOKENS)
    .sort((x, y) => x.n.occurredAt!.localeCompare(y.n.occurredAt!));
  // Inverse document frequency over the news headlines in the window.
  const df = new Map<string, number>();
  for (const x of articles) for (const t of x.tokens) df.set(t, (df.get(t) ?? 0) + 1);
  const idf = (t: string) => Math.log((articles.length + 1) / ((df.get(t) ?? 0) + 1));
  for (let i = 0; i < articles.length; i++) {
    for (let j = i + 1; j < articles.length; j++) {
      const x = articles[i]!;
      const y = articles[j]!;
      if (hours(x.n.occurredAt!, y.n.occurredAt!) > HEADLINE_HOURS) break;
      const { score, shared } = weightedOverlap(x.tokens, y.tokens, idf);
      if (score >= HEADLINE_SIMILARITY && shared.length >= HEADLINE_MIN_SHARED)
        links.push({
          a: x.n.id, b: y.n.id, kind: 'headline',
          reason: `Headlines within ${HEADLINE_HOURS} hours share distinctive words: ${shared.slice(0, 4).join(', ')}.`,
        });
    }
  }
  return links;
}

export interface Story {
  id: string;
  title: string;
  members: { id: string; kind: LinkKind; reason: string }[];
  firstSeen: string;
  lastSeen: string;
  severity: number;
  anchors: string[];
  outlets: string[];
}

const outletOf = (n: NodeRow): string =>
  n.type === 'article'
    ? ((n.attrs.outlet as string | undefined) ?? (n.attrs.domain as string | undefined) ?? 'news')
    : n.attrs.kev
      ? 'CISA KEV'
      : n.attrs.ghsa && !n.attrs.nvd
        ? 'GitHub'
        : 'NVD';

/** Pure: union-find over the links; every cluster with at least two items is a story. */
export function clusterStories(items: NodeRow[], links: StoryLink[]): Story[] {
  const parent = new Map(items.map((n) => [n.id, n.id]));
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  for (const l of links) {
    if (!parent.has(l.a) || !parent.has(l.b)) continue;
    const ra = find(l.a);
    const rb = find(l.b);
    if (ra !== rb) parent.set(rb, ra);
  }

  const groups = new Map<string, NodeRow[]>();
  for (const n of items) groups.set(find(n.id), [...(groups.get(find(n.id)) ?? []), n]);

  const strongest = new Map<string, StoryLink>();
  for (const l of links) {
    for (const id of [l.a, l.b]) {
      const prev = strongest.get(id);
      if (!prev || LINK_CONFIDENCE[l.kind] > LINK_CONFIDENCE[prev.kind]) strongest.set(id, l);
    }
  }

  const stories: Story[] = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const sorted = [...members].sort((a, b) => a.occurredAt!.localeCompare(b.occurredAt!) || a.id.localeCompare(b.id));
    const byRank = [...members].sort((a, b) => (b.severity ?? 0) - (a.severity ?? 0) || a.id.localeCompare(b.id));
    // Title preference: English news headline → KEV vulnerability name → English advisory → anything.
    const english = (n: NodeRow) => ((n.attrs.language as string | undefined) ?? 'en') === 'en';
    const lead =
      byRank.find((n) => n.type === 'article' && n.category !== 'advisory' && english(n)) ??
      byRank.find((n) => n.type === 'vulnerability' && n.attrs.kev) ??
      byRank.find((n) => n.type === 'article' && english(n)) ??
      byRank[0]!;
    const anchors = [
      ...new Set(
        members
          .filter((n) => n.type === 'vulnerability')
          .sort((a, b) => (b.severity ?? 0) - (a.severity ?? 0))
          .map((n) => (n.attrs.cveId as string | undefined) ?? (n.attrs.ghsa as { id?: string } | undefined)?.id ?? n.id),
      ),
    ];
    stories.push({
      // Stable while the story's earliest item stays the same.
      id: `story:${sha1(sorted[0]!.id)}`,
      title: lead.title,
      members: sorted.map((n) => ({ id: n.id, kind: strongest.get(n.id)!.kind, reason: strongest.get(n.id)!.reason })),
      firstSeen: sorted[0]!.occurredAt!,
      lastSeen: sorted.at(-1)!.occurredAt!,
      severity: Math.max(...members.map((n) => n.severity ?? 0)),
      anchors,
      outlets: [...new Set(members.map(outletOf))],
    });
  }
  return stories.sort((a, b) => b.lastSeen.localeCompare(a.lastSeen) || a.id.localeCompare(b.id));
}

/** Rebuilds all stories: story nodes, inferred `part_of` edges, and a `story` hint on each member. */
export function runStories(store: Store, now: Date = new Date()): { stories: number; members: number } {
  store.registerSource(STORY_SOURCE);
  const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000).toISOString();
  const items = [...store.nodesByType('vulnerability'), ...store.nodesByType('article')].filter((n) => n.occurredAt && n.occurredAt >= since);
  const ids = new Set(items.map((n) => n.id));
  const edges = store.edgesByRel(['mentions', 'references', 'affects']).filter((e) => ids.has(e.src));
  const productTitles = new Map(store.nodesByType('product').map((p) => [p.id, p.title]));
  const stories = clusterStories(items, findLinks(items, edges, productTitles));

  const nodes: SentinelNode[] = stories.map((s) => ({
    id: s.id,
    type: 'story',
    title: s.title,
    summary: `${s.members.length} related items from ${s.outlets.length} source${s.outlets.length === 1 ? '' : 's'}${s.anchors.length ? ` · ${s.anchors.slice(0, 4).join(', ')}${s.anchors.length > 4 ? '…' : ''}` : ''}`,
    category: 'story',
    occurredAt: s.lastSeen,
    publishedAt: s.firstSeen,
    severity: s.severity,
    attrs: { firstSeen: s.firstSeen, lastSeen: s.lastSeen, size: s.members.length, anchors: s.anchors, outlets: s.outlets },
  }));
  const partOf: SentinelEdge[] = stories.flatMap((s) =>
    s.members.map((m) => ({
      src: m.id, dst: s.id, rel: 'part_of', basis: 'inferred' as const, confidence: LINK_CONFIDENCE[m.kind], sourceId: STORY_SOURCE.id,
      rationale: m.reason,
    })),
  );
  store.replaceStories(nodes, partOf, STORY_SOURCE.id, stories.flatMap((s) => s.members.map((m) => [m.id, { id: s.id, title: s.title, size: s.members.length }] as const)));
  return { stories: stories.length, members: partOf.length };
}
