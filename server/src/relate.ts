import type { Store, NodeRow } from './store.ts';
import type { SentinelEdge, SourceMeta } from './types.ts';
import { clamp01, cveNodeId } from './sources/common.ts';

export const INFERENCE_SOURCE: SourceMeta = {
  id: 'sentinel-inference',
  name: 'SENTINEL inference',
  homepage: 'https://github.com/HVStudios/sentinel/blob/main/docs/ARCHITECTURE.md#relationship-inference-relatets',
  description: 'Relationships derived by SENTINEL from text matching. Always marked as inferred, with confidence.',
};

export const CONFIDENCE = { cveMention: 0.95, cveReference: 0.9, vendorMention: 0.6 } as const;

/** Vendor names that are ordinary words or placeholders and would produce false matches. */
const VENDOR_STOPLIST = new Set(
  ['multiple', 'multiple vendors', 'unknown', 'various', 'generic', 'open', 'smart', 'total', 'advanced', 'digital', 'global',
    'general', 'progress', 'real', 'apple tv', 'n/a', 'none', 'other', 'the', 'project', 'software', 'linux kernel'].map((s) => s.toLowerCase()),
);

const CVE_RE = /\bCVE-\d{4}-\d{4,7}\b/gi;
const GHSA_RE = /\bGHSA(?:-[23456789cfghjmpqrvwx]{4}){3}\b/gi;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A vendor name is matchable if it is distinctive: ≥ 4 chars, or an all-caps acronym such as SAP. */
export const isMatchableVendor = (name: string): boolean =>
  !VENDOR_STOPLIST.has(name.toLowerCase()) && (name.length >= 4 || /^[A-Z0-9][A-Z0-9-]{1,}$/.test(name));

export interface VendorMatcher {
  id: string;
  name: string;
  re: RegExp;
}

export function buildVendorMatchers(vendors: Pick<NodeRow, 'id' | 'title'>[]): VendorMatcher[] {
  return vendors
    .filter((v) => isMatchableVendor(v.title))
    .map((v) => ({
      id: v.id,
      name: v.title,
      // Case-sensitive on purpose: headlines capitalise brand names, and this avoids "oracle"/"progress" style hits.
      re: new RegExp(`(?<![\\w-])${escapeRe(v.title)}(?![\\w-])`),
    }));
}

export const extractCves = (text: string): string[] => [...new Set((text.match(CVE_RE) ?? []).map((c) => c.toUpperCase()))];
/** GitHub advisory IDs, normalised to `GHSA-xxxx-xxxx-xxxx` (lower-case body, as GitHub writes them). */
export const extractGhsas = (text: string): string[] => [...new Set((text.match(GHSA_RE) ?? []).map((g) => `GHSA${g.slice(4).toLowerCase()}`))];

/** Pure inference over the given nodes; `exists` reports whether a node id is in the store. */
export function inferEdges(
  articles: Pick<NodeRow, 'id' | 'title' | 'summary'>[],
  vulnerabilities: Pick<NodeRow, 'id' | 'summary' | 'attrs'>[],
  vendors: VendorMatcher[],
  exists: (id: string) => boolean,
  /** GHSA ID → node carrying it (a `ghsa:` node, or a CVE node enriched by GitHub). */
  ghsaIndex: Map<string, string> = new Map(),
): SentinelEdge[] {
  const edges: SentinelEdge[] = [];
  const sourceId = INFERENCE_SOURCE.id;

  for (const a of articles) {
    const text = `${a.title} ${a.summary ?? ''}`;
    for (const cve of extractCves(text)) {
      if (!exists(cveNodeId(cve))) continue;
      edges.push({
        src: a.id, dst: cveNodeId(cve), rel: 'mentions', basis: 'inferred', confidence: CONFIDENCE.cveMention, sourceId,
        rationale: `Text contains the exact identifier ${cve}.`,
      });
    }
    for (const g of extractGhsas(text)) {
      const target = ghsaIndex.get(g);
      if (!target || edges.some((e) => e.src === a.id && e.dst === target)) continue;
      edges.push({
        src: a.id, dst: target, rel: 'mentions', basis: 'inferred', confidence: CONFIDENCE.cveMention, sourceId,
        rationale: `Text contains the exact identifier ${g}.`,
      });
    }
    for (const v of vendors) {
      if (!v.re.test(text)) continue;
      edges.push({
        src: a.id, dst: v.id, rel: 'mentions', basis: 'inferred', confidence: CONFIDENCE.vendorMention, sourceId,
        rationale: `Text contains the vendor name “${v.name}”; the article may refer to something else with the same name.`,
      });
    }
  }

  for (const v of vulnerabilities) {
    const self = v.id.slice(4);
    // NVD's description replaces KEV's as `summary`; CISA's own text (e.g. "can be chained with…") is kept in attrs.
    const kevText = (v.attrs?.kev as { description?: string } | undefined)?.description ?? '';
    for (const cve of extractCves(`${v.summary ?? ''} ${kevText}`)) {
      if (cve === self || !exists(cveNodeId(cve))) continue;
      edges.push({
        src: v.id, dst: cveNodeId(cve), rel: 'references', basis: 'inferred', confidence: CONFIDENCE.cveReference, sourceId,
        rationale: `The NVD or CISA description of ${self} refers to ${cve} (e.g. an exploit chain).`,
      });
    }
  }
  return edges;
}

/**
 * Normalised vulnerability ranking. Confirmed exploitation outranks theoretical severity:
 * KEV-listed CVEs occupy 0.90–1.00 and everything else 0–0.89; within each band the
 * stronger of CVSS/10 and EPSS decides.
 */
export function vulnerabilitySeverity(attrs: Record<string, unknown>): number {
  const cvss = (attrs.cvss as { score?: number } | null | undefined)?.score;
  const epss = (attrs.epss as { score?: number } | undefined)?.score;
  const strength = clamp01(Math.max(cvss != null ? cvss / 10 : 0, epss ?? 0));
  return Math.round((attrs.kev ? 0.9 + 0.1 * strength : 0.89 * strength) * 1000) / 1000;
}

export interface ArticleRank {
  score: number;
  factors: string[];
}

const CATEGORY_BASE: Record<string, [number, string]> = {
  advisory: [0.55, 'government advisory'],
  'security-news': [0.45, 'security news'],
  ai: [0.35, 'AI news'],
  'tech-news': [0.3, 'tech news'],
  tech: [0.3, 'tech news'],
};

/**
 * SENTINEL's own ranking for articles, which have no source-provided severity. Every
 * contribution is listed in `factors` so the UI can explain the number; it is a heuristic
 * for ordering, not a fact about the article.
 */
export function articleRank(
  article: Pick<NodeRow, 'category' | 'attrs'>,
  links: { kevCves: number; cves: number },
): ArticleRank {
  const [base, label] = CATEGORY_BASE[article.category ?? ''] ?? [0.3, 'news'];
  let score = base;
  const factors = [`${label} (+${base.toFixed(2)})`];
  const points = Number((article.attrs as { points?: number } | undefined)?.points ?? 0);
  if (points > 0) {
    const bonus = (Math.min(points, 1000) / 1000) * 0.3;
    score += bonus;
    factors.push(`${points} Hacker News points (+${bonus.toFixed(2)})`);
  }
  if (links.kevCves > 0) {
    score += 0.25;
    factors.push('mentions a CISA KEV-listed CVE (+0.25)');
  } else if (links.cves > 0) {
    score += 0.1;
    factors.push('mentions a known CVE (+0.10)');
  }
  return { score: Math.round(clamp01(score) * 1000) / 1000, factors };
}

export function runInference(store: Store): { edges: number } {
  store.registerSource(INFERENCE_SOURCE);
  const vulns = store.nodesByType('vulnerability');
  const ids = new Set(vulns.map((v) => v.id));
  const ghsaIndex = new Map<string, string>();
  for (const v of vulns) {
    const g = (v.attrs.ghsa as { id?: string } | undefined)?.id;
    if (g) ghsaIndex.set(`GHSA${g.slice(4).toLowerCase()}`, v.id);
  }
  const edges = inferEdges(
    store.nodesByType('article'),
    vulns,
    buildVendorMatchers(store.nodesByType('vendor')),
    (id) => ids.has(id),
    ghsaIndex,
  );
  store.replaceInferredEdges(INFERENCE_SOURCE.id, edges);

  const kev = new Set(vulns.filter((v) => v.attrs.kev).map((v) => v.id));
  const links = new Map<string, { kevCves: number; cves: number }>();
  for (const e of edges) {
    if (!e.dst.startsWith('cve:') || e.rel !== 'mentions') continue;
    const l = links.get(e.src) ?? { kevCves: 0, cves: 0 };
    l.cves++;
    if (kev.has(e.dst)) l.kevCves++;
    links.set(e.src, l);
  }

  const update = store.db.prepare('update nodes set severity = ? where id = ?');
  const updateArticle = store.db.prepare(`update nodes set severity = ?, attrs = json_set(attrs, '$.rank', json(?)) where id = ?`);
  store.transaction(() => {
    for (const v of vulns) update.run(vulnerabilitySeverity(v.attrs), v.id);
    for (const a of store.nodesByType('article')) {
      const rank = articleRank(a, links.get(a.id) ?? { kevCves: 0, cves: 0 });
      updateArticle.run(rank.score, JSON.stringify(rank), a.id);
    }
  });
  return { edges: edges.length };
}
