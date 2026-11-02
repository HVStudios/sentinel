import type { SourceRun } from '../api.ts';
import { formatDate } from '../lib/format.ts';

const BAR = 5;
const GAP = 1;
const H = 22;

export type RunOutcome = 'ok' | 'warn' | 'error';
export const runOutcome = (r: SourceRun): RunOutcome => (r.status === 'error' ? 'error' : r.error ? 'warn' : 'ok');

export const formatDuration = (ms: number) => (ms < 1_000 ? `${ms} ms` : ms < 60_000 ? `${(ms / 1_000).toFixed(1)} s` : `${(ms / 60_000).toFixed(1)} min`);

export interface RunSummary {
  total: number;
  ok: number;
  warn: number;
  error: number;
  medianMs: number;
}

export function summarizeRuns(runs: SourceRun[]): RunSummary {
  const by = { ok: 0, warn: 0, error: 0 };
  for (const r of runs) by[runOutcome(r)]++;
  const d = runs.map((r) => r.durationMs).sort((a, b) => a - b);
  const medianMs = d.length ? (d.length % 2 ? d[(d.length - 1) / 2]! : Math.round((d[d.length / 2 - 1]! + d[d.length / 2]!) / 2)) : 0;
  return { total: runs.length, ...by, medianMs };
}

/** "14 runs: 12 ok, 1 with warnings, 1 failed · median 2.1 s" */
export function describeRuns(runs: SourceRun[]): string {
  const s = summarizeRuns(runs);
  const parts = [`${s.ok} ok`, s.warn ? `${s.warn} with warnings` : '', s.error ? `${s.error} failed` : ''].filter(Boolean);
  return `${s.total} ${s.total === 1 ? 'run' : 'runs'}: ${parts.join(', ')} · median ${formatDuration(s.medianMs)}`;
}

/**
 * One bar per run, oldest on the left: the colour is the outcome, the height the number of records
 * (a failed run is drawn full height so it stands out). The text below says the same for
 * screen readers, so the bars themselves are hidden from them.
 */
export function RunHistory({ runs }: { runs: SourceRun[] }) {
  if (!runs.length) return <span className="muted">—</span>;
  const max = Math.max(1, ...runs.map((r) => r.count));
  const w = runs.length * (BAR + GAP);
  return (
    <div className="run-history">
      <svg viewBox={`0 0 ${w} ${H}`} width={w} height={H} aria-hidden="true">
        {runs.map((r, i) => {
          const outcome = runOutcome(r);
          const h = outcome === 'error' ? H : Math.max(2, (r.count / max) * H);
          return (
            <rect key={i} x={i * (BAR + GAP)} y={H - h} width={BAR} height={h} className={`run-${outcome}`}>
              <title>{`${formatDate(r.at)}: ${outcome === 'error' ? 'failed' : `${r.count} records`} in ${formatDuration(r.durationMs)}${r.error ? ` — ${r.error}` : ''}`}</title>
            </rect>
          );
        })}
      </svg>
      <div className="muted small">{describeRuns(runs)}</div>
    </div>
  );
}
