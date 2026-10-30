import { useMemo, useState } from 'react';
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationLinkDatum, type SimulationNodeDatum } from 'd3-force';
import type { SEdge, SNode } from '../api.ts';
import { TYPE_LABEL } from '../lib/format.ts';

const W = 520;
const H = 340;

interface GNode extends SimulationNodeDatum {
  id: string;
  node: SNode;
}
interface GLink extends SimulationLinkDatum<GNode> {
  edge: SEdge;
}

const REL_LABEL: Record<string, string> = {
  affects: 'affects',
  made_by: 'made by',
  has_weakness: 'has weakness',
  mentions: 'mentions',
  references: 'references',
};

/** Static force layout: computed once per graph, so rendering stays deterministic and cheap. */
export function layoutGraph(nodes: SNode[], edges: SEdge[], rootId: string) {
  const gnodes: GNode[] = nodes.map((n, i) => {
    const a = (i / Math.max(nodes.length, 1)) * Math.PI * 2;
    return n.id === rootId ? { id: n.id, node: n, x: 0, y: 0, fx: 0, fy: 0 } : { id: n.id, node: n, x: Math.cos(a) * 100, y: Math.sin(a) * 100 };
  });
  const ids = new Set(gnodes.map((g) => g.id));
  const links: GLink[] = edges.filter((e) => ids.has(e.src) && ids.has(e.dst)).map((e) => ({ source: e.src, target: e.dst, edge: e }));
  const sim = forceSimulation(gnodes)
    .force('link', forceLink<GNode, GLink>(links).id((d) => d.id).distance((l) => (l.edge.basis === 'inferred' ? 110 : 80)))
    .force('charge', forceManyBody().strength(-160))
    .force('collide', forceCollide(18))
    .force('x', forceX(0).strength(0.04))
    .force('y', forceY(0).strength(0.06))
    .stop();
  for (let i = 0; i < 220; i++) sim.tick();
  return { nodes: gnodes, links: links as (GLink & { source: GNode; target: GNode })[] };
}

interface Props {
  nodes: SNode[];
  edges: SEdge[];
  rootId: string;
  onSelect: (id: string) => void;
}

export function Graph({ nodes, edges, rootId, onSelect }: Props) {
  const layout = useMemo(() => layoutGraph(nodes, edges, rootId), [nodes, edges, rootId]);
  const [hoverEdge, setHoverEdge] = useState<SEdge | null>(null);
  const xs = layout.nodes.map((n) => n.x ?? 0);
  const ys = layout.nodes.map((n) => n.y ?? 0);
  const pad = 40;
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad;
  const vw = Math.max(Math.max(...xs) + pad - minX, W / 2);
  const vh = Math.max(Math.max(...ys) + pad - minY, H / 2);

  return (
    <div className="graph">
      <svg viewBox={`${minX} ${minY} ${vw} ${vh}`} role="img" aria-label="Relationship graph">
        {layout.links.map((l) => (
          <line
            key={`${l.edge.src}|${l.edge.dst}|${l.edge.rel}`}
            x1={l.source.x}
            y1={l.source.y}
            x2={l.target.x}
            y2={l.target.y}
            className={`link link-${l.edge.basis}`}
            strokeOpacity={l.edge.basis === 'inferred' ? 0.35 + 0.6 * l.edge.confidence : 0.8}
            onMouseEnter={() => setHoverEdge(l.edge)}
            onMouseLeave={() => setHoverEdge(null)}
          >
            <title>{`${REL_LABEL[l.edge.rel] ?? l.edge.rel} · ${l.edge.basis}${l.edge.basis === 'inferred' ? ` (confidence ${Math.round(l.edge.confidence * 100)}%)` : ''}`}</title>
          </line>
        ))}
        {layout.nodes.map((g) => {
          const root = g.id === rootId;
          return (
            <g
              key={g.id}
              transform={`translate(${g.x},${g.y})`}
              className={`gnode gnode-${g.node.type}${root ? ' root' : ''}`}
              onClick={() => !root && onSelect(g.id)}
              role="button"
              tabIndex={0}
              aria-label={`${TYPE_LABEL[g.node.type]}: ${g.node.title}`}
              onKeyDown={(e) => e.key === 'Enter' && !root && onSelect(g.id)}
            >
              <circle r={root ? 11 : 7} />
              <text y={root ? 24 : 18} textAnchor="middle">
                {shortLabel(g.node)}
              </text>
              <title>{`${TYPE_LABEL[g.node.type]}: ${g.node.title}`}</title>
            </g>
          );
        })}
      </svg>
      <div className="graph-legend">
        <span>
          <svg width="26" height="8" aria-hidden>
            <line x1="0" x2="26" y1="4" y2="4" className="link link-reported" />
          </svg>{' '}
          reported by source
        </span>
        <span>
          <svg width="26" height="8" aria-hidden>
            <line x1="0" x2="26" y1="4" y2="4" className="link link-inferred" />
          </svg>{' '}
          inferred by SENTINEL
        </span>
        {hoverEdge?.rationale && <span className="muted">{hoverEdge.rationale}</span>}
      </div>
    </div>
  );
}

export function shortLabel(n: SNode): string {
  if (n.type === 'vulnerability') return (n.attrs.cveId as string) ?? n.id.slice(4);
  let t = n.title;
  // "Ivanti Connect Secure" → "Connect Secure": the vendor is already a node in the graph.
  const vendor = typeof n.attrs?.vendor === 'string' ? n.attrs.vendor : null;
  if (n.type === 'product' && vendor && t.toLowerCase().startsWith(`${vendor.toLowerCase()} `)) t = t.slice(vendor.length + 1);
  return t.length > 22 ? `${t.slice(0, 21)}…` : t;
}
