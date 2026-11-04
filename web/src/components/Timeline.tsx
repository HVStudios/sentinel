import { useEffect, useRef, useState } from 'react';
import type { TimedType } from '../api.ts';
import { TYPE_LABEL } from '../lib/format.ts';
import { Icon } from './Icon.tsx';

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
  /** Told when playback starts and stops, so the steps can share one history entry. */
  onPlayingChange?: (playing: boolean) => void;
}

/** Step interval: slower under reduced motion, where the brush also jumps instead of sliding. */
const STEP_MS = 900;
const STEP_MS_REDUCED = 2200;
const reducedMotion = () => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

/**
 * Playback: the brushed window (or an eighth of the range if nothing is brushed) steps forward a
 * quarter of its width at a time until it reaches the end of the range, so events appear in order.
 * Exported for tests.
 */
export function playbackStep(fromMs: number, toMs: number, bucketMs: number, sel: { from: number; to: number } | null, restart: boolean) {
  const span = toMs - fromMs;
  const width = sel ? sel.to - sel.from : Math.max(bucketMs, Math.round(span / 8 / bucketMs) * bucketMs);
  const step = Math.max(bucketMs, Math.round(width / 4));
  if (!sel || restart) return { from: fromMs, to: Math.min(toMs, fromMs + width), done: fromMs + width >= toMs };
  const to = Math.min(toMs, sel.to + step);
  return { from: to - width, to, done: to >= toMs };
}

export function Timeline({ from, to, bucketMs, series, selection, onBrush, onPlayingChange }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<{ x0: number; x1: number } | null>(null);
  const [playing, setPlaying] = useState(false);
  const [status, setStatus] = useState('');
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);

  const selMs = selection ? { from: Date.parse(selection.from), to: Date.parse(selection.to) } : null;
  const atEnd = Boolean(selMs && selMs.to >= toMs - bucketMs / 2);
  const latest = useRef({ selMs, onBrush, fromMs, toMs, bucketMs });
  latest.current = { selMs, onBrush, fromMs, toMs, bucketMs };

  const brushTo = (r: { from: number; to: number }) => onBrush({ from: new Date(r.from).toISOString(), to: new Date(r.to).toISOString() });
  const stepBy = (dir: 1 | -1) => {
    const width = selMs ? selMs.to - selMs.from : null;
    if (dir === 1) {
      const n = playbackStep(fromMs, toMs, bucketMs, selMs, false);
      brushTo(n);
    } else if (selMs && width) {
      const stepW = Math.max(bucketMs, Math.round(width / 4));
      const f = Math.max(fromMs, selMs.from - stepW);
      brushTo({ from: f, to: f + width });
    }
  };

  useEffect(() => onPlayingChange?.(playing), [playing]);
  // A new range (another preset) stops playback.
  useEffect(() => setPlaying(false), [from, to]);

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(
      () => {
        const c = latest.current;
        const n = playbackStep(c.fromMs, c.toMs, c.bucketMs, c.selMs, false);
        c.onBrush({ from: new Date(n.from).toISOString(), to: new Date(n.to).toISOString() });
        if (n.done) {
          setPlaying(false);
          setStatus('Playback reached the end of the range');
        }
      },
      reducedMotion() ? STEP_MS_REDUCED : STEP_MS,
    );
    return () => window.clearInterval(id);
  }, [playing]);

  const togglePlay = () => {
    if (playing) {
      setPlaying(false);
      setStatus('Playback paused');
      return;
    }
    // Start from the beginning when nothing is brushed or the window already sits at the end.
    if (!selMs || atEnd) brushTo(playbackStep(fromMs, toMs, bucketMs, selMs, true));
    setPlaying(true);
    setStatus('Playing: the time window steps forward');
  };
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
          setPlaying(false);
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
        {sel && <rect className={`brush${drag ? '' : ' brush-set'}`} x={sel.x} y={0} width={Math.max(sel.w, 1)} height={H - PAD_B} />}
      </svg>
      <div className="timeline-legend">
        <div className="playback" role="group" aria-label="Timeline playback">
          <button type="button" className="ghost" onClick={() => stepBy(-1)} disabled={!selMs || selMs.from <= fromMs} aria-label="Step back" title="Step the window back">
            <Icon name="stepBack" />
          </button>
          <button type="button" className={`ghost play${playing ? ' on' : ''}`} onClick={togglePlay} aria-label={playing ? 'Pause playback' : 'Play'} title={playing ? 'Pause' : 'Play the range in time order'}>
            <Icon name={playing ? 'pause' : 'play'} filled={!playing} />
            <span aria-hidden="true">{playing ? 'Pause' : 'Play'}</span>
          </button>
          <button type="button" className="ghost" onClick={() => stepBy(1)} disabled={atEnd} aria-label="Step forward" title="Step the window forward">
            <Icon name="stepForward" />
          </button>
        </div>
        <span className="sr-only" role="status" aria-live="polite">
          {status}
        </span>
        {ORDER.map((t) => (
          <span key={t} className="legend-item">
            <i className={`swatch-${t}`} /> {TYPE_LABEL[t]}
          </span>
        ))}
        <span className="muted">
          {playing ? 'Playing in time order' : selection ? 'Click the chart to clear the selection' : 'Drag across the chart to focus a time window, or press Play'}
        </span>
      </div>
    </div>
  );
}
