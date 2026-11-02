import { emptyBatch, type Batch } from '../types.ts';
import { RateLimiter } from '../http.ts';
import { cveNodeId, type SourceModule } from './common.ts';

export const EPSS_API = 'https://api.first.org/data/v1/epss';
const BATCH = 100;
/** How far back a CVE's score history reaches; older change points are folded into the first kept day. */
export const HISTORY_DAYS = 365;

interface EpssDay {
  epss: string;
  percentile: string;
  date: string;
}

export interface EpssResponse {
  status: string;
  /** With `scope=time-series`, each row also carries the previous 30 days. */
  data: (EpssDay & { cve: string; 'time-series'?: EpssDay[] })[];
}

/**
 * A score history as change points: `[date, score]` where the score differs from the previous
 * point, so a score that holds for weeks costs one entry. The score holds until the next point,
 * or until `epss.date` for the last one. Scores are rounded (see `round`) so noise-level changes
 * do not add points.
 */
export type EpssHistory = [string, number][];

const meta = {
  id: 'first-epss',
  name: 'FIRST Exploit Prediction Scoring System',
  homepage: 'https://www.first.org/epss/',
  description: 'Daily estimated probability that a CVE will be exploited in the next 30 days.',
};

// Low scores keep 3 significant digits; high ones 4 decimals, so 0.9996 does not become 1 ("100%").
const round = (score: number) => (score >= 0.1 ? Math.round(score * 10_000) / 10_000 : Number(score.toPrecision(3)));

/**
 * Merges newly fetched days into a stored history. Fetched days win over stored points from the
 * same period (FIRST's own series is authoritative); stored points before it are kept, so the
 * history grows beyond the API's 30-day window as ingests continue.
 */
export function mergeEpssHistory(stored: EpssHistory | undefined, days: { date: string; score: number }[], latest: string): EpssHistory {
  const fetched = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const from = fetched[0]?.date ?? latest;
  const all: EpssHistory = [...(stored ?? []).filter(([d]) => d < from), ...fetched.map((d): [string, number] => [d.date, round(d.score)])];
  const cutoff = new Date(Date.parse(`${latest}T00:00:00Z`) - HISTORY_DAYS * 86_400_000).toISOString().slice(0, 10);
  const out: EpssHistory = [];
  for (const [date, score] of all) {
    if (date < cutoff) {
      // Remember the score in force at the cutoff; it becomes the first kept point.
      out[0] = [cutoff, score];
      continue;
    }
    if (out.length && out[out.length - 1]![1] === score) continue;
    out.push([date, score]);
  }
  return out;
}

/** EPSS only enriches CVEs already in the store; the empty title tells the store to keep its own. */
export function parseEpss(resp: EpssResponse, known: Set<string>, histories: Map<string, EpssHistory> = new Map()): Batch {
  const b = emptyBatch();
  for (const row of resp.data) {
    const id = cveNodeId(row.cve);
    if (!known.has(id)) continue;
    const days = [row, ...(row['time-series'] ?? [])].map((d) => ({ date: d.date, score: Number(d.epss) })).filter((d) => d.date && Number.isFinite(d.score));
    b.nodes.push({
      id,
      type: 'vulnerability',
      title: '',
      attrs: {
        epss: { score: Number(row.epss), percentile: Number(row.percentile), date: row.date, history: mergeEpssHistory(histories.get(id), days, row.date) },
      },
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
    const histories = ctx.store.epssHistories();
    const cves = ids.map((id) => id.slice(4));
    const limiter = new RateLimiter(5, 1_000);
    const out = emptyBatch();
    for (let i = 0; i < cves.length; i += BATCH) {
      await limiter.acquire();
      // The time series (last 30 days) backfills a new CVE's history and fills gaps between runs.
      const resp = await ctx.fetchJson<EpssResponse>(`${EPSS_API}?scope=time-series&cve=${cves.slice(i, i + BATCH).join(',')}`);
      const part = parseEpss(resp, known, histories);
      out.nodes.push(...part.nodes);
      out.provenance.push(...part.provenance);
    }
    return out;
  },
};
