import { emptyBatch, type Batch } from '../types.ts';
import { cveNodeId, cweNodeId, cweUrl, toIso, type SourceModule } from './common.ts';

export const GHSA_API = 'https://api.github.com/advisories';
const WINDOW_DAYS = 7;
const MAX_PAGES = 5;
const SEVERITIES = ['critical', 'high'] as const;

interface GhsaAdvisory {
  ghsa_id: string;
  cve_id: string | null;
  html_url: string;
  summary: string;
  severity: string;
  published_at: string;
  updated_at: string;
  withdrawn_at: string | null;
  cvss?: { vector_string: string | null; score: number | null } | null;
  cvss_severities?: { cvss_v3?: { vector_string: string | null; score: number | null }; cvss_v4?: { vector_string: string | null; score: number | null } };
  cwes?: { cwe_id: string; name: string }[];
  vulnerabilities?: { package: { ecosystem: string; name: string } | null; vulnerable_version_range: string | null; first_patched_version: string | null }[];
}

const meta = {
  id: 'github-advisories',
  name: 'GitHub Security Advisories',
  homepage: 'https://github.com/advisories',
  description: 'GitHub-reviewed advisories for open-source packages (npm, PyPI, Go, Maven, crates.io…), high and critical only.',
};

export const ghsaNodeId = (id: string) => `ghsa:${id.toUpperCase()}`;
export const packageNodeId = (ecosystem: string, name: string) => `package:${ecosystem.toLowerCase()}/${name}`;

function cvssOf(a: GhsaAdvisory) {
  const v4 = a.cvss_severities?.cvss_v4;
  const v3 = a.cvss_severities?.cvss_v3 ?? a.cvss ?? undefined;
  const pick = v4?.score ? { ...v4, version: '4.0' } : v3?.score ? { ...v3, version: '3.1' } : null;
  return pick ? { version: pick.version, score: pick.score!, severity: a.severity.toUpperCase(), vector: pick.vector_string ?? '', source: 'GitHub' } : null;
}

/**
 * Advisories with a CVE attach to the CVE node; if the store already has that CVE (from KEV/NVD)
 * only GitHub's facts are added and its title and CVSS are kept. Advisories without a CVE become
 * `ghsa:` vulnerability nodes. Affected packages are product nodes `package:<ecosystem>/<name>`.
 */
export function parseGhsa(advisories: GhsaAdvisory[], existingIds: Set<string>): Batch {
  const b = emptyBatch();
  const refs = new Set<string>();
  const ref = (node: Batch['nodes'][number], sourceUrl: string) => {
    if (refs.has(node.id)) return;
    refs.add(node.id);
    b.nodes.push(node);
    b.provenance.push({ nodeId: node.id, sourceId: meta.id, sourceUrl });
  };

  for (const a of advisories) {
    if (a.withdrawn_at) continue;
    const id = a.cve_id ? cveNodeId(a.cve_id) : ghsaNodeId(a.ghsa_id);
    const packages = (a.vulnerabilities ?? [])
      .filter((v) => v.package)
      .map((v) => ({ ecosystem: v.package!.ecosystem, name: v.package!.name, vulnerable: v.vulnerable_version_range, patched: v.first_patched_version }));
    const ghsa = { id: a.ghsa_id, url: a.html_url, severity: a.severity, packages, publishedAt: toIso(a.published_at) };
    const cvss = cvssOf(a);
    if (existingIds.has(id)) {
      b.nodes.push({ id, type: 'vulnerability', title: '', attrs: { ghsa } });
    } else {
      b.nodes.push({
        id,
        type: 'vulnerability',
        title: a.summary.trim(),
        summary: a.summary.trim(),
        url: a.html_url,
        category: a.cve_id ? 'cve' : 'ghsa',
        occurredAt: toIso(a.published_at),
        publishedAt: toIso(a.published_at),
        updatedAt: toIso(a.updated_at),
        attrs: { ...(a.cve_id ? { cveId: a.cve_id.toUpperCase() } : {}), ghsa, cvss },
      });
    }
    b.provenance.push({ nodeId: id, sourceId: meta.id, sourceUrl: a.html_url });

    for (const p of packages) {
      const pid = packageNodeId(p.ecosystem, p.name);
      ref({ id: pid, type: 'product', title: `${p.name} (${p.ecosystem})`, attrs: { ecosystem: p.ecosystem, package: p.name } }, a.html_url);
      b.edges.push({ src: id, dst: pid, rel: 'affects', basis: 'reported', confidence: 1, sourceId: meta.id });
    }
    for (const c of a.cwes ?? []) {
      if (!/^CWE-\d+$/.test(c.cwe_id)) continue;
      ref({ id: cweNodeId(c.cwe_id), type: 'weakness', title: c.cwe_id, url: cweUrl(c.cwe_id) }, a.html_url);
      b.edges.push({ src: id, dst: cweNodeId(c.cwe_id), rel: 'has_weakness', basis: 'reported', confidence: 1, sourceId: meta.id });
    }
  }
  return b;
}

/** Next-page URL from a GitHub `Link` header. */
export const nextLink = (link: string | null): string | null => /<([^>]+)>;\s*rel="next"/.exec(link ?? '')?.[1] ?? null;

export const ghsaSource: SourceModule = {
  meta,
  async run(ctx) {
    const since = new Date(ctx.now().getTime() - WINDOW_DAYS * 86_400_000).toISOString();
    const headers: Record<string, string> = { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' };
    // In GitHub Actions the workflow token raises the limit from 60 to 1,000 requests an hour.
    if (ctx.env.GITHUB_TOKEN) headers.authorization = `Bearer ${ctx.env.GITHUB_TOKEN}`;
    const advisories: GhsaAdvisory[] = [];
    for (const severity of SEVERITIES) {
      let url: string | null = `${GHSA_API}?${new URLSearchParams({ type: 'reviewed', severity, sort: 'published', direction: 'desc', per_page: '100', published: `>=${since.slice(0, 10)}` })}`;
      for (let page = 0; url && page < MAX_PAGES; page++) {
        const res: { body: GhsaAdvisory[]; headers: Headers } = await ctx.fetchJsonWithHeaders<GhsaAdvisory[]>(url, { headers, accept: 'application/vnd.github+json' });
        advisories.push(...res.body.filter((a) => a.published_at >= since));
        url = res.body.length && res.body.at(-1)!.published_at >= since ? nextLink(res.headers.get('link')) : null;
      }
    }
    const ids = new Set(ctx.store.idsByType('vulnerability'));
    return parseGhsa(advisories, ids);
  },
};
