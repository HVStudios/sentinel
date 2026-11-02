const W = 240;
const H = 36;
const PAD = 3;
const DAY = 86_400_000;

export interface EpssAttrs {
  score: number;
  date: string;
  /** `[date, score]` change points; each score holds until the next point (or `date`). */
  history?: [string, number][];
}

export const epssPercent = (s: number) => `${(s * 100).toFixed(s < 0.01 ? 2 : 1)}%`;
const day = (d: string) => Date.parse(`${d}T00:00:00Z`);
const shortDate = (d: string) => new Date(day(d)).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** How the score moved over the stored history, in words; also the chart's accessible name. */
export function describeEpssHistory(e: EpssAttrs): string | null {
  const h = e.history ?? [];
  if (!h.length) return null;
  const [firstDate, first] = h[0]!;
  const last = h[h.length - 1]![1];
  const range = `${shortDate(firstDate)} – ${shortDate(e.date)}`;
  if (h.length === 1) return `Unchanged at ${epssPercent(first)} from ${range}`;
  const lo = Math.min(...h.map(([, s]) => s));
  const peak = Math.max(...h.map(([, s]) => s));
  if (last === first) return `Moved between ${epssPercent(lo)} and ${epssPercent(peak)}, back at ${epssPercent(last)}, ${range}`;
  const extra = peak > Math.max(first, last) ? `; peak ${epssPercent(peak)}` : '';
  return `${last > first ? 'Rose' : 'Fell'} from ${epssPercent(first)} to ${epssPercent(last)}, ${range}${extra}`;
}

/** A step chart of the stored EPSS history, scaled to its own range so small moves show. */
export function EpssSparkline({ epss }: { epss: EpssAttrs }) {
  const h = epss.history ?? [];
  const label = describeEpssHistory(epss);
  if (!label) return null;
  const start = day(h[0]![0]);
  const span = Math.max(day(epss.date) - start, DAY);
  const scores = h.map(([, s]) => s);
  const lo = Math.min(...scores);
  const hi = Math.max(...scores);
  const x = (d: string) => PAD + ((day(d) - start) / span) * (W - 2 * PAD);
  const y = (s: number) => (hi === lo ? H / 2 : H - PAD - ((s - lo) / (hi - lo)) * (H - 2 * PAD));
  let path = `M${x(h[0]![0])},${y(h[0]![1])}`;
  for (const [d, s] of h.slice(1)) path += ` H${x(d)} V${y(s)}`;
  path += ` H${W - PAD}`;
  const rising = scores[scores.length - 1]! > scores[0]!;
  return (
    <span className="epss-history">
      <svg viewBox={`0 0 ${W} ${H}`} className={`epss-spark${rising ? ' rising' : ''}`} role="img" aria-label={`EPSS history: ${label}`}>
        <path d={path} />
        {h.map(([d, s]) => (
          <circle key={d} cx={x(d)} cy={y(s)} r={2}>
            <title>{`${shortDate(d)}: ${epssPercent(s)}`}</title>
          </circle>
        ))}
      </svg>
      <span className="muted small" aria-hidden="true">
        {label}
      </span>
    </span>
  );
}
