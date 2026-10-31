import { emptyBatch, type Batch } from '../types.ts';
import { RateLimiter } from '../http.ts';
import { cveNodeId, type SourceModule } from './common.ts';

export const EPSS_API = 'https://api.first.org/data/v1/epss';
const BATCH = 100;

export interface EpssResponse {
  status: string;
  data: { cve: string; epss: string; percentile: string; date: string }[];
}

const meta = {
  id: 'first-epss',
  name: 'FIRST Exploit Prediction Scoring System',
  homepage: 'https://www.first.org/epss/',
  description: 'Daily estimated probability that a CVE will be exploited in the next 30 days.',
};

/** EPSS only enriches CVEs already in the store; the empty title tells the store to keep its own. */
export function parseEpss(resp: EpssResponse, known: Set<string>): Batch {
  const b = emptyBatch();
  for (const row of resp.data) {
    const id = cveNodeId(row.cve);
    if (!known.has(id)) continue;
    b.nodes.push({
      id,
      type: 'vulnerability',
      title: '',
      attrs: { epss: { score: Number(row.epss), percentile: Number(row.percentile), date: row.date } },
    });
    b.provenance.push({ nodeId: id, sourceId: meta.id, sourceUrl: `${EPSS_API}?cve=${row.cve}` });
  }
  return b;
}

export const epssSource: SourceModule = {
  meta,
  async run(ctx) {
    // EPSS scores CVEs only; GitHub-only advisories (ghsa:…) have no CVE.
    const ids = ctx.store.idsByType('vulnerability').filter((id) => id.startsWith('cve:'));
    const known = new Set(ids);
    const cves = ids.map((id) => id.slice(4));
    const limiter = new RateLimiter(5, 1_000);
    const out = emptyBatch();
    for (let i = 0; i < cves.length; i += BATCH) {
      await limiter.acquire();
      const resp = await ctx.fetchJson<EpssResponse>(`${EPSS_API}?cve=${cves.slice(i, i + BATCH).join(',')}`);
      const part = parseEpss(resp, known);
      out.nodes.push(...part.nodes);
      out.provenance.push(...part.provenance);
    }
    return out;
  },
};
