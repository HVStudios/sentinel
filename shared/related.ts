/** Minimal shapes, so the server (SQLite rows) and the browser (snapshot JSON) can both use this. */
export interface RelNode {
  id: string;
  type: string;
  title: string;
  occurredAt?: string | null;
  attrs?: Record<string, unknown>;
}
export interface RelEdge {
  src: string;
  dst: string;
  rel: string;
}

/**
 * What a watched item is "related to", by type, using explicit links only:
 * - vendor:        vulnerabilities affecting its products; articles mentioning the vendor;
 * - product:       vulnerabilities affecting it; articles mentioning those vulnerabilities;
 * - vulnerability: articles mentioning it; vulnerabilities it references or that reference it;
 * - weakness:      vulnerabilities with that weakness;
 * - story:         its members.
 * Shared by the server (Store.related) and the static (GitHub Pages) engine, which pass in their own lookups.
 */
export interface RelatedLookup<N extends RelNode = RelNode> {
  node(id: string): N | undefined;
  edges(id: string): RelEdge[];
}

export interface RelatedItem<N extends RelNode = RelNode> {
  node: N;
  /** Human-readable path, e.g. "affects Ivanti Connect Secure". */
  via: string;
}

const TIMED = new Set(['vulnerability', 'natural_event', 'article']);
const label = (n: RelNode) => (n.attrs?.cveId as string | undefined) ?? n.title;

export function relatedItems<N extends RelNode>(lookup: RelatedLookup<N>, id: string, limit = 50): RelatedItem<N>[] {
  const root = lookup.node(id);
  if (!root) return [];
  const out = new Map<string, RelatedItem<N>>();
  const add = (otherId: string, via: string) => {
    if (otherId === id || out.has(otherId)) return;
    const n = lookup.node(otherId);
    if (n && TIMED.has(n.type) && n.occurredAt) out.set(otherId, { node: n, via });
  };
  const incoming = (nodeId: string, rel: string) => lookup.edges(nodeId).filter((e) => e.dst === nodeId && e.rel === rel);
  const outgoing = (nodeId: string, rel: string) => lookup.edges(nodeId).filter((e) => e.src === nodeId && e.rel === rel);
  const mentionsOf = (vulnId: string, vulnLabel: string) => {
    for (const e of incoming(vulnId, 'mentions')) add(e.src, `mentions ${vulnLabel}`);
  };

  switch (root.type) {
    case 'vendor':
      for (const p of incoming(id, 'made_by')) {
        const product = lookup.node(p.src);
        for (const a of incoming(p.src, 'affects')) add(a.src, `affects ${product?.title ?? p.src}`);
      }
      for (const m of incoming(id, 'mentions')) add(m.src, `mentions ${root.title}`);
      break;
    case 'product':
      for (const a of incoming(id, 'affects')) {
        add(a.src, `affects ${root.title}`);
        const v = lookup.node(a.src);
        if (v) mentionsOf(v.id, label(v));
      }
      break;
    case 'vulnerability':
      mentionsOf(id, label(root));
      for (const e of outgoing(id, 'references')) add(e.dst, `referenced by ${label(root)}`);
      for (const e of incoming(id, 'references')) add(e.src, `references ${label(root)}`);
      break;
    case 'weakness':
      for (const e of incoming(id, 'has_weakness')) add(e.src, `has weakness ${root.title}`);
      break;
    case 'story':
      for (const e of incoming(id, 'part_of')) add(e.src, 'part of this story');
      break;
    default:
      break;
  }
  return [...out.values()]
    .sort((a, b) => b.node.occurredAt!.localeCompare(a.node.occurredAt!) || a.node.id.localeCompare(b.node.id))
    .slice(0, limit);
}
