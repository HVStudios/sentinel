import { emptyBatch, type Batch } from '../types.ts';
import { RateLimiter } from '../http.ts';
import type { SourceModule } from './common.ts';

export const WDQS = 'https://query.wikidata.org/sparql';
const BATCH = 20;
const RECHECK_DAYS = 30;
/** Per-run time budget; vendors not reached are looked up on the next run (most-affected vendors go first). */
const BUDGET_MS = 120_000;

/** Name variants tried for each vendor; a match on the bare name is preferred. */
export const NAME_SUFFIXES = ['', ' Inc.', ' Corporation', ' Networks', ' Systems', ' Software'];

/**
 * A candidate only counts if its English description says it is a technology organisation.
 * This is what keeps "Apple" from resolving to Apple Records or "Progress" to a German publisher.
 */
const TECH = /software|technolog|computer|electronic|semiconductor|telecom|internet|network|information|cyber|security|surveillance|hardware|cloud|\bweb\b|video game|open.source|free software|digital|automation|embedded|conglomerate/i;

/**
 * Only label matches are placed on the map. An item reached only through an alias is shown as a
 * possible match in the investigation view (aliases produced wrong identities in testing, e.g.
 * "Facebook" → Reality Labs).
 */
export const CONFIDENCE = { exactLabel: 0.8, variantLabel: 0.7, alias: 0.55 } as const;
export const MAP_MIN_CONFIDENCE = CONFIDENCE.variantLabel;

const meta = {
  id: 'wikidata-vendors',
  name: 'Wikidata (vendor headquarters)',
  homepage: 'https://www.wikidata.org/',
  description:
    'Headquarters of vendors, looked up by name. The vendor-to-Wikidata identity is inferred; the headquarters are as reported by Wikidata.',
};

interface Binding {
  name: { value: string };
  item: { value: string };
  itemLabel?: { value: string };
  desc?: { value: string };
  hqLabel?: { value: string };
  countryLabel?: { value: string };
  coord?: { value: string };
}

export interface WdqsResponse {
  results: { bindings: Binding[] };
}

/** The shape stored in vendor `attrs.wikidata`. Absent values are explicit nulls so a re-check fully replaces the old one. */
export interface VendorWikidata {
  status: 'matched' | 'ambiguous' | 'none';
  qid: string | null;
  label: string | null;
  description: string | null;
  url: string | null;
  hq: { label: string; country: string | null; lat: number | null; lon: number | null } | null;
  matchedBy: 'exact label' | 'name variant' | 'alias' | null;
  confidence: number | null;
  candidates: string[];
  checkedAt: string;
}

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

export function buildQuery(names: string[]): string {
  const values = names.flatMap((n) => NAME_SUFFIXES.map((s) => `"${esc(n + s)}"@en`)).join(' ');
  return `SELECT ?name ?item ?itemLabel ?desc ?hqLabel ?countryLabel ?coord WHERE {
  VALUES ?name { ${values} }
  { ?item rdfs:label ?name } UNION { ?item skos:altLabel ?name }
  ?item wdt:P159 ?hq .
  OPTIONAL { ?item schema:description ?desc FILTER(lang(?desc) = "en") }
  OPTIONAL { ?hq wdt:P17 ?country }
  OPTIONAL { ?hq wdt:P625 ?coord }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`;
}

/** WKT `Point(lon lat)` → coordinates; anything else → null (no guessed location). */
export function parsePoint(wkt: string | undefined): { lat: number; lon: number } | null {
  const m = /^Point\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)$/.exec(wkt ?? '');
  if (!m) return null;
  const lon = Number(m[1]);
  const lat = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}

interface Candidate {
  qid: string;
  label: string;
  description: string;
  exactLabel: boolean;
  /** The item's label is the vendor name or one of its variants (not just an alias). */
  labelMatch: boolean;
  hq: { label: string; country: string | null; point: { lat: number; lon: number } | null };
}

/**
 * Resolution rules, in order:
 * 1. keep candidates whose description marks them as a technology organisation;
 * 2. one candidate → match;
 * 3. several → the single one whose label is exactly the vendor name, if there is one;
 * 4. several that all share the same headquarters (e.g. duplicate items) → the lowest QID;
 * 5. otherwise ambiguous, and the vendor is not placed on the map.
 * The match basis (exact label, name variant, alias) sets the confidence; see CONFIDENCE.
 */
export function resolveVendors(names: string[], resp: WdqsResponse, checkedAt: string): Map<string, VendorWikidata> {
  const byVariant = new Map<string, string>();
  for (const n of names) for (const s of NAME_SUFFIXES) if (!byVariant.has(n + s)) byVariant.set(n + s, n);

  const cands = new Map<string, Map<string, Candidate>>();
  for (const b of resp.results.bindings) {
    const variant = b.name.value;
    const vendor = byVariant.get(variant);
    if (!vendor) continue;
    const qid = b.item.value.slice(b.item.value.lastIndexOf('/') + 1);
    const label = b.itemLabel?.value ?? qid;
    const list = cands.get(vendor) ?? new Map<string, Candidate>();
    const prev = list.get(qid);
    list.set(qid, {
      qid,
      label,
      description: b.desc?.value ?? '',
      exactLabel: (prev?.exactLabel ?? false) || label === vendor,
      labelMatch: (prev?.labelMatch ?? false) || label === variant,
      hq: prev?.hq.point ? prev.hq : { label: b.hqLabel?.value ?? '', country: b.countryLabel?.value ?? null, point: parsePoint(b.coord?.value) },
    });
    cands.set(vendor, list);
  }

  const out = new Map<string, VendorWikidata>();
  for (const name of names) {
    const all = [...(cands.get(name)?.values() ?? [])];
    const tech = all.filter((c) => TECH.test(c.description));
    let pick: Candidate | undefined;
    if (tech.length === 1) pick = tech[0];
    else if (tech.length > 1) {
      const exact = tech.filter((c) => c.exactLabel);
      if (exact.length === 1) pick = exact[0];
      else if (new Set(tech.map((c) => `${c.hq.label}|${c.hq.country}`)).size === 1)
        pick = tech.reduce((a, c) => (Number(c.qid.slice(1)) < Number(a.qid.slice(1)) ? c : a));
    }
    const base = { candidates: tech.map((c) => c.qid).sort(), checkedAt };
    if (!pick) {
      out.set(name, { status: tech.length ? 'ambiguous' : 'none', qid: null, label: null, description: null, url: null, hq: null, matchedBy: null, confidence: null, ...base });
      continue;
    }
    out.set(name, {
      status: 'matched',
      qid: pick.qid,
      label: pick.label,
      description: pick.description || null,
      url: `https://www.wikidata.org/wiki/${pick.qid}`,
      hq: { label: pick.hq.label, country: pick.hq.country, lat: pick.hq.point?.lat ?? null, lon: pick.hq.point?.lon ?? null },
      matchedBy: pick.exactLabel ? 'exact label' : pick.labelMatch ? 'name variant' : 'alias',
      confidence: pick.exactLabel ? CONFIDENCE.exactLabel : pick.labelMatch ? CONFIDENCE.variantLabel : CONFIDENCE.alias,
      ...base,
    });
  }
  return out;
}

export const wikidataSource: SourceModule = {
  meta,
  async run(ctx) {
    const now = ctx.now();
    const stale = new Date(now.getTime() - RECHECK_DAYS * 86_400_000).toISOString();
    const affected = ctx.store.vendorVulnerabilityCounts();
    const vendors = ctx.store
      .nodesByType('vendor')
      .filter((v) => {
        const checkedAt = (v.attrs.wikidata as VendorWikidata | undefined)?.checkedAt;
        return !checkedAt || checkedAt < stale;
      })
      .sort((a, b) => (affected.get(b.id) ?? 0) - (affected.get(a.id) ?? 0) || a.id.localeCompare(b.id));
    const started = Date.now();
    const budgetMs = Number(ctx.env.WIKIDATA_BUDGET_MS ?? BUDGET_MS);
    const limiter = new RateLimiter(1, 1_000);
    const out: Batch = emptyBatch();
    const warnings: string[] = [];

    let skipped = 0;
    let reached = 0;
    // Hard time bound: one request at a time, no retries, budget checked before each request.
    // A failed batch is skipped and its vendors stay unchecked, so the next run retries them.
    for (let i = 0; i < vendors.length; i += BATCH) {
      if (Date.now() - started > budgetMs) break;
      await limiter.acquire();
      const batch = vendors.slice(i, i + BATCH);
      const names = batch.map((v) => v.title);
      reached = i + batch.length;
      let resp: WdqsResponse;
      try {
        resp = await ctx.fetchJson<WdqsResponse>(WDQS, {
          method: 'POST',
          form: { query: buildQuery(names) },
          accept: 'application/sparql-results+json',
          timeoutMs: 20_000,
          retries: 0,
        });
      } catch (err) {
        skipped += batch.length;
        warnings.push(`${names.length} vendors (${names[0]}…): ${(err as Error).message}`);
        continue;
      }
      const resolved = resolveVendors(names, resp, now.toISOString());
      for (const v of batch) {
        const wd = resolved.get(v.title)!;
        out.nodes.push({ id: v.id, type: 'vendor', title: '', attrs: { wikidata: wd } });
        if (wd.status === 'matched') out.provenance.push({ nodeId: v.id, sourceId: meta.id, sourceUrl: wd.url });
      }
    }
    if (reached < vendors.length) ctx.log(`wikidata: time budget reached; ${vendors.length - reached} vendors left for the next run`);
    if (vendors.length && reached && skipped === reached) throw new Error(`all lookups failed: ${warnings.slice(0, 3).join('; ')}`);
    ctx.log(`wikidata: ${out.nodes.length} vendors checked, ${out.provenance.length} matched`);
    return { ...out, warnings: warnings.length > 5 ? [...warnings.slice(0, 5), `…and ${warnings.length - 5} more`] : warnings };
  },
};
