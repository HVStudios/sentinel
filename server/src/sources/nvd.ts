import { emptyBatch, type Batch } from '../types.ts';
import { RateLimiter } from '../http.ts';
import { cveNodeId, cweNodeId, cweUrl, nvdUrl, productNodeId, toIso, vendorNodeId, type SourceModule } from './common.ts';

export const NVD_API = 'https://services.nvd.nist.gov/rest/json/cves/2.0';
const MAX_PRODUCTS_PER_CVE = 25;
const MAX_REFERENCES = 10;
/** Recently published CVEs are kept only if notable, so the feed is not flooded. */
const RECENT_MIN_CVSS = 7;

interface CvssMetric {
  source: string;
  type: 'Primary' | 'Secondary';
  cvssData: { version: string; baseScore: number; baseSeverity?: string; vectorString: string };
  baseSeverity?: string;
}

interface NvdCve {
  id: string;
  published: string;
  lastModified: string;
  vulnStatus?: string;
  descriptions: { lang: string; value: string }[];
  metrics?: Record<string, CvssMetric[] | undefined>;
  weaknesses?: { source: string; description: { lang: string; value: string }[] }[];
  configurations?: { nodes?: { cpeMatch?: { vulnerable: boolean; criteria: string }[] }[] }[];
  references?: { url: string; source?: string; tags?: string[] }[];
  cisaExploitAdd?: string;
  cisaVulnerabilityName?: string;
}

export interface NvdResponse {
  resultsPerPage: number;
  startIndex: number;
  totalResults: number;
  vulnerabilities: { cve: NvdCve }[];
}

const meta = {
  id: 'nvd',
  name: 'NIST National Vulnerability Database',
  homepage: 'https://nvd.nist.gov/',
  description: 'CVE details: CVSS scores, weaknesses (CWE), affected products (CPE) and references.',
};

export interface Cvss {
  version: string;
  score: number;
  severity: string | null;
  vector: string;
  source: string;
}

/** Highest CVSS version available, preferring the NVD primary score within a version. */
export function bestCvss(metrics: NvdCve['metrics']): Cvss | null {
  for (const key of ['cvssMetricV40', 'cvssMetricV31', 'cvssMetricV30', 'cvssMetricV2']) {
    const list = metrics?.[key];
    if (!list?.length) continue;
    const m = list.find((x) => x.type === 'Primary') ?? list[0]!;
    return {
      version: m.cvssData.version,
      score: m.cvssData.baseScore,
      severity: m.cvssData.baseSeverity ?? m.baseSeverity ?? null,
      vector: m.cvssData.vectorString,
      source: m.source,
    };
  }
  return null;
}

/** `cpe:2.3:a:ivanti:connect_secure:*:...` → `{ vendor: 'ivanti', product: 'connect_secure' }` */
export function parseCpe(cpe: string): { vendor: string; product: string; part: string } | null {
  const parts = cpe.split(':');
  if (parts.length < 6 || parts[0] !== 'cpe' || parts[1] !== '2.3') return null;
  const [, , part, vendor, product] = parts as [string, string, string, string, string];
  if (!vendor || !product || vendor === '*' || product === '*') return null;
  const unescape = (s: string) => s.replace(/\\(.)/g, '$1');
  return { part, vendor: unescape(vendor), product: unescape(product) };
}

const humanize = (s: string) => s.replace(/_/g, ' ').replace(/\b[a-z]/g, (c) => c.toUpperCase());

export function parseNvd(resp: NvdResponse, opts: { onlyNotable?: boolean } = {}): Batch & { skipped: string[] } {
  const b = { ...emptyBatch(), skipped: [] as string[] };
  const refs = new Set<string>();
  const ref = (node: Batch['nodes'][number]) => {
    if (refs.has(node.id)) return;
    refs.add(node.id);
    b.nodes.push(node);
    b.provenance.push({ nodeId: node.id, sourceId: meta.id, sourceUrl: meta.homepage });
  };

  for (const { cve } of resp.vulnerabilities) {
    const mark = [b.nodes.length, b.edges.length, b.provenance.length] as const;
    try {
      parseOne(cve);
    } catch {
      // One malformed record must not discard the rest of the page; drop its partial output.
      b.nodes.length = mark[0];
      b.edges.length = mark[1];
      b.provenance.length = mark[2];
      b.skipped.push(cve?.id ?? 'unknown');
    }
  }
  return b;

  function parseOne(cve: NvdCve) {
    const cvss = bestCvss(cve.metrics);
    if (opts.onlyNotable && !cve.cisaExploitAdd && (cvss?.score ?? 0) < RECENT_MIN_CVSS) return;

    const id = cveNodeId(cve.id);
    const desc = cve.descriptions.find((d) => d.lang === 'en')?.value ?? cve.descriptions[0]?.value ?? '';
    b.nodes.push({
      id,
      type: 'vulnerability',
      title: cve.cisaVulnerabilityName ?? `${cve.id}: ${desc.length > 90 ? `${desc.slice(0, 87)}…` : desc}`,
      summary: desc,
      url: nvdUrl(cve.id),
      category: cve.cisaExploitAdd ? 'kev' : 'cve',
      occurredAt: toIso(cve.cisaExploitAdd ?? cve.published),
      publishedAt: toIso(cve.published),
      updatedAt: toIso(cve.lastModified),
      attrs: {
        cveId: cve.id,
        cvss,
        nvd: {
          status: cve.vulnStatus ?? null,
          published: toIso(cve.published),
          lastModified: toIso(cve.lastModified),
          references: (cve.references ?? []).slice(0, MAX_REFERENCES).map((r) => ({ url: r.url, tags: r.tags ?? [] })),
        },
      },
    });
    b.provenance.push({ nodeId: id, sourceId: meta.id, sourceUrl: nvdUrl(cve.id) });

    const cwes = new Set(
      (cve.weaknesses ?? []).flatMap((w) => w.description.map((d) => d.value)).filter((v) => /^CWE-\d+$/.test(v)),
    );
    for (const cwe of cwes) {
      ref({ id: cweNodeId(cwe), type: 'weakness', title: cwe, url: cweUrl(cwe) });
      b.edges.push({ src: id, dst: cweNodeId(cwe), rel: 'has_weakness', basis: 'reported', confidence: 1, sourceId: meta.id });
    }

    const products = new Map<string, { vendor: string; product: string }>();
    for (const cfg of cve.configurations ?? []) {
      for (const node of cfg.nodes ?? []) {
        for (const m of node.cpeMatch ?? []) {
          if (!m.vulnerable) continue;
          const p = parseCpe(m.criteria);
          if (p && products.size < MAX_PRODUCTS_PER_CVE) products.set(productNodeId(p.vendor, p.product), p);
        }
      }
    }
    for (const [productId, p] of products) {
      const vendorId = vendorNodeId(p.vendor);
      ref({ id: vendorId, type: 'vendor', title: humanize(p.vendor) });
      ref({ id: productId, type: 'product', title: `${humanize(p.vendor)} ${humanize(p.product)}`, attrs: { vendor: p.vendor } });
      b.edges.push(
        { src: id, dst: productId, rel: 'affects', basis: 'reported', confidence: 1, sourceId: meta.id },
        { src: productId, dst: vendorId, rel: 'made_by', basis: 'reported', confidence: 1, sourceId: meta.id },
      );
    }
  }
}

const merge = (into: Batch, from: Batch) => {
  into.nodes.push(...from.nodes);
  into.edges.push(...from.edges);
  into.provenance.push(...from.provenance);
};

export const nvdSource: SourceModule = {
  meta,
  async run(ctx) {
    const key = ctx.env.NVD_API_KEY;
    // NVD public limits: 5 requests / 30 s without a key, 50 with one.
    const limiter = new RateLimiter(key ? 50 : 5, 30_000);
    const headers = key ? { apiKey: key } : undefined;
    const pageSize = 500;
    const out = emptyBatch();

    const pages = async (params: Record<string, string>, onlyNotable: boolean) => {
      for (let start = 0; ; start += pageSize) {
        await limiter.acquire();
        const qs = new URLSearchParams({ ...params, resultsPerPage: String(pageSize), startIndex: String(start) });
        // `hasKev` is a valueless flag in the NVD API.
        const url = `${NVD_API}?${qs.toString().replace('hasKev=', 'hasKev')}`;
        const resp = await ctx.fetchJson<NvdResponse>(url, { headers, timeoutMs: 90_000, retries: 3 });
        const { skipped, ...batch } = parseNvd(resp, { onlyNotable });
        if (skipped.length) ctx.log(`nvd: skipped malformed records ${skipped.join(', ')}`);
        merge(out, batch);
        ctx.log(`nvd: ${Math.min(start + pageSize, resp.totalResults)}/${resp.totalResults}`);
        if (start + pageSize >= resp.totalResults) break;
      }
    };

    // 1. Every KEV-listed CVE (one paginated query via the hasKev flag).
    await pages({ hasKev: '' }, false);
    // 2. Notable CVEs published recently (NVD allows ≤ 120-day windows).
    const days = Math.min(Number(ctx.env.NVD_RECENT_DAYS ?? 3) || 3, 120);
    const end = ctx.now();
    const start = new Date(end.getTime() - days * 86_400_000);
    await pages({ pubStartDate: start.toISOString(), pubEndDate: end.toISOString() }, true);
    return out;
  },
};
