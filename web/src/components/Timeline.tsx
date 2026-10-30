import { useRef, useState } from 'react';
import type { TimedType } from '../api.ts';
import { TYPE_LABEL } from '../lib/format.ts';

const W = 960;
const H = 84;
const PAD_B = 16;
const ORDER: TimedType[] = ['vulnerability', 'natural_event', 'article'];

interface Props {
  from: string;
  to: string;
  bucketMs: number;
  series: Partial<Record<TimedType, number[]>>;
  /** Currently brushed window, if narrower than [from, to]. */
  selection: { from: string; to: string } | null;
  onBrush: (range: { from: string; to: string } | null) => void;
}

export function Timeline({ from, to, bucketMs, series, selection, onBrush }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<{ x0: number; x1: number } | null>(null);
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  const n = Math.max(...ORDER.map((t) => series[t]?.length ?? 0), 1);
  const totals = Array.from({ length: n }, (_, i) => ORDER.reduce((s, t) => s + (series[t]?.[i] ?? 0), 0));
  const max = Math.max(1, ...totals);
  const bw = W / n;
  const xToMs = (x: number) => fromMs + (Math.min(Math.max(x, 0), W) / W) * (toMs - fromMs);
  const msToX = (ms: number) => ((ms - fromMs) / (toMs - fromMs)) * W;

  const localX = (clientX: number) => {
    const r = svgRef.current!.getBoundingClientRect();
    return ((clientX - r.left) / Math.max(r.width, 1)) * W;
  };

  const ticks = Array.from({ length: 5 }, (_, i) => fromMs + ((toMs - fromMs) * i) / 4);
  const spanDays = (toMs - fromMs) / 86_400_000;
  const tickLabel = (ms: number) =>
    new Date(ms).toLocaleString(undefined, spanDays <= 2 ? { hour: '2-digit', minute: '2-digit' } : { month: 'short', day: 'numeric' });

  const sel = drag
    ? { x: Math.min(drag.x0, drag.x1), w: Math.abs(drag.x1 - drag.x0) }
    : selection
      ? { x: msToX(Date.parse(selection.from)), w: msToX(Date.parse(selection.to)) - msToX(Date.parse(selection.from)) }
      : null;

  return (
    <div className="timeline">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Activity from ${from} to ${to}. Drag to select a time window.`}
        onPointerDown={(e) => {
          (e.target as Element).setPointerCapture?.(e.pointerId);
          const x = localX(e.clientX);
          setDrag({ x0: x, x1: x });
        }}
        onPointerMove={(e) => drag && setDrag({ ...drag, x1: localX(e.clientX) })}
        onPointerUp={() => {
          if (!drag) return;
          const [a, b] = [drag.x0, drag.x1].sort((p, q) => p - q) as [number, number];
          setDrag(null);
          // A click (no drag) clears the brush.
          onBrush(b - a < 4 ? null : { from: new Date(xToMs(a)).toISOString(), to: new Date(xToMs(b)).toISOString() });
        }}
      >
        {totals.map((_, i) => {
          let y = H - PAD_B;
          return ORDER.map((t) => {
            const v = series[t]?.[i] ?? 0;
            if (!v) return null;
            const h = (v / max) * (H - PAD_B - 6);
            y -= h;
            return (
              <rect key={`${t}-${i}`} x={i * bw + 0.5} y={y} width={Math.max(bw - 1, 0.5)} height={h} className={`bar bar-${t}`}>
                <title>{`${new Date(fromMs + i * bucketMs).toLocaleString()} — ${TYPE_LABEL[t]}: ${v}`}</title>
              </rect>
            );
          });
        })}
        <line x1={0} x2={W} y1={H - PAD_B} y2={H - PAD_B} className="axis" />
        {ticks.map((ms, i) => (
          <text key={ms} x={msToX(ms)} y={H - 3} className="tick" textAnchor={i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : 'middle'}>
            {tickLabel(ms)}
          </text>
        ))}
        {sel && <rect className="brush" x={sel.x} y={0} width={Math.max(sel.w, 1)} height={H - PAD_B} />}
      </svg>
      <div className="timeline-legend">
        {ORDER.map((t) => (
          <span key={t} className="legend-item">
            <i className={`swatch-${t}`} /> {TYPE_LABEL[t]}
          </span>
        ))}
        <span className="muted">{selection ? 'Click the chart to clear the selection' : 'Drag across the chart to focus a time window'}</span>
      </div>
    </div>
  );
}
