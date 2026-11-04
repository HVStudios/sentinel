import { useEffect, useLayoutEffect, useState, type RefObject } from 'react';
import type { ZoomTransform } from 'd3-zoom';

/**
 * Curved overprint lines from the open item to the places it is linked to: solid blue to vendor
 * headquarters (reported links), dashed magenta to publisher countries (inferred mentions). Drawn in
 * screen pixels over the map, under the floating panels, from a port on the investigation panel's
 * edge next to its heading (or from the item's own point when it has a location).
 * Purely visual: the Layers card lists the same links as text.
 */

export interface LinkTarget {
  key: string;
  basis: 'reported' | 'inferred';
  /** Map (viewBox) coordinates, before the zoom transform. */
  x: number;
  y: number;
  /** 0–1; inferred lines fade with lower confidence. */
  confidence: number;
}

/** How the map's viewBox is laid out inside its padded SVG element (preserveAspectRatio meet). */
export interface SvgFrame {
  left: number;
  top: number;
  scale: number;
}

export function svgFrame(svg: SVGSVGElement, w: number, h: number): SvgFrame | null {
  const r = svg.getBoundingClientRect();
  const cs = getComputedStyle(svg);
  const pl = parseFloat(cs.paddingLeft) || 0;
  const pr = parseFloat(cs.paddingRight) || 0;
  const pt = parseFloat(cs.paddingTop) || 0;
  const pb = parseFloat(cs.paddingBottom) || 0;
  const cw = r.width - pl - pr;
  const ch = r.height - pt - pb;
  if (!(cw > 0 && ch > 0)) return null;
  const scale = Math.min(cw / w, ch / h);
  return { left: r.left + pl + (cw - w * scale) / 2, top: r.top + pt + (ch - h * scale) / 2, scale };
}

interface Props {
  svgRef: RefObject<SVGSVGElement | null>;
  wrapRef: RefObject<HTMLDivElement | null>;
  w: number;
  h: number;
  transform: ZoomTransform;
  /** A located item's own point (map coordinates); otherwise lines leave from the panel. */
  origin: { x: number; y: number } | null;
  targets: LinkTarget[];
}

interface Geometry {
  width: number;
  height: number;
  port: { x: number; y: number; side: 'left' | 'bottom' } | null;
  ends: (LinkTarget & { px: number; py: number })[];
  clip: { x: number; y: number; w: number; h: number };
}

const same = (a: Geometry | null, b: Geometry | null) => JSON.stringify(a) === JSON.stringify(b);

/** A gentle arc that bows away from the straight line, like a great-circle route on a chart. */
function arc(x0: number, y0: number, x1: number, y1: number, scale = 1) {
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  // Reported lines bow upwards (towards the top of the sheet) whichever way the line runs; inferred ones downwards.
  const sign = dx >= 0 ? -1 : 1;
  const bow = Math.min(70, len * 0.14) * sign * scale;
  const cx = mx + (-dy / len) * bow;
  const cy = my + (dx / len) * bow;
  return `M${x0.toFixed(1)},${y0.toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`;
}

export function SelectionLines({ svgRef, wrapRef, w, h, transform, origin, targets }: Props) {
  const [geo, setGeo] = useState<Geometry | null>(null);
  const [tick, setTick] = useState(0);

  // Re-measure when the window resizes, anything scrolls (the panel, or the page on a phone), or the panel changes size.
  useEffect(() => {
    let raf = 0;
    const bump = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setTick((t) => t + 1));
    };
    window.addEventListener('resize', bump);
    document.addEventListener('scroll', bump, true);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(bump) : null;
    const panel = document.querySelector('.investigate');
    if (panel) ro?.observe(panel);
    if (wrapRef.current) ro?.observe(wrapRef.current);
    // The panel's content (and heading position) settles after its detail loads.
    const mo = typeof MutationObserver !== 'undefined' && panel ? new MutationObserver(bump) : null;
    if (panel) mo?.observe(panel, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', bump);
      document.removeEventListener('scroll', bump, true);
      ro?.disconnect();
      mo?.disconnect();
    };
  }, [wrapRef]);

  useLayoutEffect(() => {
    const svg = svgRef.current;
    const wrap = wrapRef.current;
    const frame = svg && svgFrame(svg, w, h);
    if (!svg || !wrap || !frame || !targets.length) {
      setGeo((g) => (g === null ? g : null));
      return;
    }
    const wr = wrap.getBoundingClientRect();
    const sr = svg.getBoundingClientRect();
    const toPx = (x: number, y: number) => {
      const [tx, ty] = transform.apply([x, y]);
      return { px: frame.left + tx * frame.scale - wr.left, py: frame.top + ty * frame.scale - wr.top };
    };
    let port: Geometry['port'] = null;
    if (origin) {
      const o = toPx(origin.x, origin.y);
      port = { x: o.px, y: o.py, side: 'left' };
    } else {
      const panel = document.querySelector<HTMLElement>('.investigate');
      const heading = panel?.querySelector<HTMLElement>('.inv-head h2') ?? panel?.querySelector<HTMLElement>('.inv-bar');
      if (panel && heading) {
        const pr = panel.getBoundingClientRect();
        const hr = heading.getBoundingClientRect();
        if (pr.top >= sr.bottom - 2) {
          // Stacked layout (phone): the panel sits below the map, so the port is on the map's bottom edge.
          port = { x: Math.min(Math.max(hr.left + 16, sr.left + 16), sr.right - 16) - wr.left, y: sr.bottom - wr.top - 1, side: 'bottom' };
        } else {
          const y = Math.min(Math.max(hr.top + Math.min(hr.height, 28) / 2, pr.top + 18), pr.bottom - 18);
          port = { x: pr.left - wr.left, y: y - wr.top, side: 'left' };
        }
      }
    }
    const next: Geometry = {
      width: wr.width,
      height: wr.height,
      port,
      ends: targets.map((t) => ({ ...t, ...toPx(t.x, t.y) })),
      clip: { x: sr.left - wr.left, y: sr.top - wr.top, w: sr.width, h: sr.height },
    };
    setGeo((g) => (same(g, next) ? g : next));
  }, [svgRef, wrapRef, w, h, transform, origin, targets, tick]);

  if (!geo?.port) return null;
  const { port } = geo;
  return (
    <svg className="selection-lines" width={geo.width} height={geo.height} aria-hidden="true" data-testid="selection-lines">
      <defs>
        <clipPath id="selection-clip">
          <rect x={geo.clip.x} y={geo.clip.y} width={geo.clip.w} height={geo.clip.h + 2} />
        </clipPath>
      </defs>
      <g clipPath="url(#selection-clip)">
        {geo.ends.map((e) => (
          <path
            key={e.key}
            // Inferred lines bow the other way, so they stay apart from reported lines to the same place.
            d={arc(port.x, port.y, e.px, e.py, e.basis === 'inferred' ? -1 : 1)}
            className={`link link-${e.basis}`}
            data-link={e.key}
            style={e.basis === 'inferred' ? { opacity: 0.45 + 0.55 * Math.min(1, Math.max(0, e.confidence)) } : undefined}
          />
        ))}
        {geo.ends.map((e) =>
          e.basis === 'reported' ? (
            <rect key={`end-${e.key}`} className="link-end link-end-reported" x={e.px - 4} y={e.py - 4} width={8} height={8} transform={`rotate(45 ${e.px} ${e.py})`} />
          ) : (
            <circle key={`end-${e.key}`} className="link-end link-end-inferred" cx={e.px} cy={e.py} r={4} />
          ),
        )}
      </g>
      <circle className={`link-port${origin ? ' link-port-point' : ''}`} cx={port.x} cy={port.y} r={origin ? 7 : 4.5} />
    </svg>
  );
}
