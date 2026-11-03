/**
 * Source health alerts, worked out from each source's recent runs (oldest first). Used by the
 * live server's UI and the static build alike, since both receive the same run history.
 */

export interface HealthRun {
  at: string;
  status: 'ok' | 'error';
  count: number;
}

export interface HealthSource {
  id: string;
  runs?: HealthRun[];
}

export interface HealthAlert {
  sourceId: string;
  kind: 'failing' | 'drop';
  /** One sentence for the Sources panel and the header tooltip. */
  reason: string;
}

/** Sources that fail often by nature (GDELT rate-limits heavily); they are judged more leniently. */
export const BEST_EFFORT_SOURCES = new Set(['gdelt']);

/** Consecutive failed runs that flag a source. */
export const FAILING_RUNS = 3;
/** A best-effort source is flagged only when none of this many latest runs returned records. */
export const BEST_EFFORT_RUNS = 12;
/** Earlier successful runs needed, and how many of them make up the baseline. */
export const DROP_MIN_RUNS = 5;
export const DROP_BASELINE_RUNS = 10;
/** Sources that usually return fewer records than this are not checked for drops (e.g. incremental lookups). */
export const DROP_MIN_MEDIAN = 20;
/** "Far below": the latest count is under this share of the baseline median. */
export const DROP_RATIO = 0.5;

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

export function sourceAlert(source: HealthSource): HealthAlert | null {
  const runs = source.runs ?? [];
  if (!runs.length) return null;
  const sourceId = source.id;

  if (BEST_EFFORT_SOURCES.has(sourceId)) {
    const recent = runs.slice(-BEST_EFFORT_RUNS);
    if (recent.length < BEST_EFFORT_RUNS || recent.some((r) => r.status === 'ok' && r.count > 0)) return null;
    return { sourceId, kind: 'failing', reason: `No records in the last ${BEST_EFFORT_RUNS} runs (best-effort source)` };
  }

  const last = runs.slice(-FAILING_RUNS);
  if (last.length === FAILING_RUNS && last.every((r) => r.status === 'error')) {
    let n = 0;
    for (let i = runs.length - 1; i >= 0 && runs[i]!.status === 'error'; i--) n++;
    return { sourceId, kind: 'failing', reason: `The last ${n} runs failed` };
  }

  const latest = runs.at(-1)!;
  if (latest.status !== 'ok') return null;
  const earlier = runs
    .slice(0, -1)
    .filter((r) => r.status === 'ok')
    .slice(-DROP_BASELINE_RUNS);
  if (earlier.length < DROP_MIN_RUNS) return null;
  const base = median(earlier.map((r) => r.count));
  if (base < DROP_MIN_MEDIAN || latest.count >= base * DROP_RATIO) return null;
  return { sourceId, kind: 'drop', reason: `Last run returned ${latest.count} records, against a recent median of ${Math.round(base)}` };
}

export const sourceAlerts = (sources: HealthSource[]): HealthAlert[] =>
  sources.map(sourceAlert).filter((a): a is HealthAlert => a !== null);
