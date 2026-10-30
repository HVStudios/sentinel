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

/** Pure inference over the given nodes; `exists` reports whether a node id is in the store. */
export function inferEdges(
  articles: Pick<NodeRow, 'id' | 'title' | 'summary'>[],
  vulnerabilities: Pick<NodeRow, 'id' | 'summary' | 'attrs'>[],
  vendors: VendorMatcher[],
  exists: (id: string) => boolean,
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

/** Normalised vulnerability ranking: the strongest of KEV listing, CVSS and EPSS. */
export function vulnerabilitySeverity(attrs: Record<string, unknown>): number {
  const cvss = (attrs.cvss as { score?: number } | null | undefined)?.score;
  const epss = (attrs.epss as { score?: number } | undefined)?.score;
  return clamp01(Math.max(attrs.kev ? 0.75 : 0, cvss != null ? cvss / 10 : 0, epss ?? 0));
}

export function runInference(store: Store): { edges: number } {
  store.registerSource(INFERENCE_SOURCE);
  const vulns = store.nodesByType('vulnerability');
  const ids = new Set(vulns.map((v) => v.id));
  const edges = inferEdges(
    store.nodesByType('article'),
    vulns,
    buildVendorMatchers(store.nodesByType('vendor')),
    (id) => ids.has(id),
  );
  store.replaceInferredEdges(INFERENCE_SOURCE.id, edges);

  const update = store.db.prepare('update nodes set severity = ? where id = ?');
  store.transaction(() => {
    for (const v of vulns) update.run(vulnerabilitySeverity(v.attrs), v.id);
  });
  return { edges: edges.length };
}
