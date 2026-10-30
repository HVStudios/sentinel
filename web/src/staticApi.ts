import type { NodeDetail, SEdge, SNode, SourceStatus, TimedType } from './api.ts';
import { TIMED_TYPES } from './api.ts';
import type { Api, Filters, SourcesResponse } from './api.ts';

/** Mirrors server/src/snapshot.ts. */
export interface Snapshot {
  format: number;
  version: string;
  generatedAt: string;
  sources: SourceStatus[];
  nodes: SNode[];
  edges: SEdge[];
  provenance: { nodeId: string; sourceId: string; sourceUrl: string | null; fetchedAt: string }[];
}

interface Index {
  snap: Snapshot;
  byId: Map<string, SNode>;
  /** Timed nodes sorted newest first, ties by id descending (same order as the server). */
  timed: SNode[];
  adj: Map<string, SEdge[]>;
  prov: Map<string, Snapshot['provenance']>;
  sources: Map<string, SourceStatus>;
}

export function indexSnapshot(snap: Snapshot): Index {
  const byId = new Map(snap.nodes.map((n) => [n.id, n]));
  const timed = snap.nodes
    .filter((n) => (TIMED_TYPES as string[]).includes(n.type) && n.occurredAt)
    .sort((a, b) => (a.occurredAt === b.occurredAt ? (a.id < b.id ? 1 : -1) : a.occurredAt! < b.occurredAt! ? 1 : -1));
  const adj = new Map<string, SEdge[]>();
  for (const e of snap.edges) {
    for (const id of [e.src, e.dst]) adj.set(id, [...(adj.get(id) ?? []), e]);
  }
  const prov = new Map<string, Snapshot['provenance']>();
  for (const p of snap.provenance) prov.set(p.nodeId, [...(prov.get(p.nodeId) ?? []), p]);
  return { snap, byId, timed, adj, prov, sources: new Map(snap.sources.map((s) => [s.id, s])) };
}

const inWindow = (f: Pick<Filters, 'from' | 'to' | 'types'>) => {
  const types = f.types.length ? f.types : TIMED_TYPES;
  return (n: SNode) =>
    types.includes(n.type as TimedType) && (!f.from || n.occurredAt! >= f.from) && (!f.to || n.occurredAt! <= f.to);
};

/** Same semantics as SQLite's case-insensitive `LIKE '%q%'` on title, summary and id. */
const matches = (q: string | undefined) => {
  if (!q) return () => true;
  const needle = q.toLowerCase();
  return (n: SNode) => [n.title, n.summary ?? '', n.id].some((s) => s.toLowerCase().includes(needle));
};

/** `mix:vulnerability=12,article=5` ⇄ per-type offsets (same format as the server). */
const encodeMixCursor = (offsets: Record<string, number>) =>
  `mix:${Object.entries(offsets).map(([t, n]) => `${t}=${n}`).join(',')}`;
const decodeMixCursor = (cursor: string | undefined): Record<string, number> => {
  const out: Record<string, number> = {};
  if (!cursor?.startsWith('mix:')) return out;
  for (const part of cursor.slice(4).split(',')) {
    const [t, n] = part.split('=');
    if (t && (TIMED_TYPES as string[]).includes(t) && /^\d+$/.test(n ?? '')) out[t] = Number(n);
  }
  return out;
};

/** Newest first, then by rank (unranked last) for `top`, mirroring the server's ORDER BY. */
const byRank = (a: SNode, b: SNode) =>
  (b.severity ?? -1) - (a.severity ?? -1) || (a.occurredAt === b.occurredAt ? (a.id < b.id ? 1 : -1) : a.occurredAt! < b.occurredAt! ? 1 : -1);

export function queryFeed(ix: Index, f: Filters, before?: string, limit = 50) {
  const win = inWindow(f);
  const m = matches(f.q);
  if (f.sort === 'mixed' || f.sort === 'top') {
    const offsets = decodeMixCursor(before);
    const lists = TIMED_TYPES.filter((t) => !f.types.length || f.types.includes(t)).map((type) => {
      let all = ix.timed.filter((n) => n.type === type && win(n) && m(n));
      if (f.sort === 'top') all = all.sort(byRank);
      const offset = offsets[type] ?? 0;
      return { type, rows: all.slice(offset, offset + limit), offset, hasMore: all.length > offset + limit };
    });
    // Round-robin, identical to interleave() in server/src/store.ts.
    const items: SNode[] = [];
    const used = lists.map(() => 0);
    for (let progressed = true; items.length < limit && progressed; ) {
      progressed = false;
      for (let i = 0; i < lists.length && items.length < limit; i++) {
        const row = lists[i]!.rows[used[i]!];
        if (row === undefined) continue;
        items.push(row);
        used[i]!++;
        progressed = true;
      }
    }
    const more = lists.some((l, i) => used[i]! < l.rows.length || l.hasMore);
    const next: Record<string, number> = {};
    lists.forEach((l, i) => { next[l.type] = l.offset + used[i]!; });
    return { items, nextCursor: more ? encodeMixCursor(next) : null };
  }

  let cut: ((n: SNode) => boolean) | null = null;
  if (before) {
    const sep = before.lastIndexOf('|');
    const t = before.slice(0, sep);
    const id = before.slice(sep + 1);
    cut = (n) => n.occurredAt! < t || (n.occurredAt === t && n.id < id);
  }
  const items: SNode[] = [];
  let more = false;
  for (const n of ix.timed) {
    if (!win(n) || !m(n) || (cut && !cut(n))) continue;
    if (items.length === limit) {
      more = true;
      break;
    }
    items.push(n);
  }
  const last = items.at(-1);
  return { items, nextCursor: more && last ? `${last.occurredAt}|${last.id}` : null };
}

export function queryMap(ix: Index, f: Filters) {
  const win = inWindow(f);
  const points: SNode[] = [];
  const counts = new Map<string, number>();
  for (const n of ix.timed) {
    if (!win(n)) continue;
    if (n.geoBasis === 'coordinates' && n.lat != null && n.lon != null && points.length < 2000) points.push(n);
    if (n.geoBasis === 'publisher_country' && n.country) counts.set(n.country, (counts.get(n.country) ?? 0) + 1);
  }
  const countries = [...counts].map(([country, count]) => ({ country, count })).sort((a, b) => b.count - a.count);
  return { points, countries };
}

export function queryTimeline(ix: Index, f: Filters & { from: string; to: string }, buckets: number) {
  const fromMs = Date.parse(f.from);
  const bucketMs = Math.max(1, Math.ceil((Date.parse(f.to) - fromMs) / buckets));
  const win = inWindow(f);
  const series: Partial<Record<TimedType, number[]>> = {};
  for (const n of ix.timed) {
    if (!win(n)) continue;
    const b = Math.floor((Date.parse(n.occurredAt!) - fromMs) / bucketMs);
    if (b < 0 || b >= buckets) continue;
    const arr = (series[n.type as TimedType] ??= new Array<number>(buckets).fill(0));
    arr[b]! += 1;
  }
  return { from: f.from, to: f.to, bucketMs, series };
}

export function queryNode(ix: Index, id: string): NodeDetail {
  const node = ix.byId.get(id);
  if (!node) throw new Error(`404 Not Found for ${id}`);
  const edges = (ix.adj.get(id) ?? []).map((e) => {
    const otherId = e.src === id ? e.dst : e.src;
    const other = ix.byId.get(otherId);
    return {
      ...e,
      direction: (e.src === id ? 'out' : 'in') as 'in' | 'out',
      other: other ? { id: other.id, type: other.type, title: other.title, occurredAt: other.occurredAt } : { id: otherId, type: null, title: otherId },
    };
  });
  const provenance = (ix.prov.get(id) ?? [])
    .map((p) => {
      const s = ix.sources.get(p.sourceId);
      return { id: p.sourceId, name: s?.name ?? p.sourceId, homepage: s?.homepage ?? '', description: s?.description ?? '', sourceUrl: p.sourceUrl, fetchedAt: p.fetchedAt };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  return { node, provenance, edges };
}

/** Breadth-first neighbourhood, preferring reported and high-confidence links (as the server does). */
export function queryGraph(ix: Index, id: string, depth = 1, limit = 60) {
  const root = ix.byId.get(id);
  if (!root) throw new Error(`404 Not Found for ${id}`);
  const seen = new Map<string, SNode>([[id, root]]);
  const edges = new Map<string, SEdge>();
  let frontier = [id];
  for (let d = 0; d < depth && frontier.length && seen.size < limit; d++) {
    const next: string[] = [];
    for (const cur of frontier) {
      const adj = [...(ix.adj.get(cur) ?? [])].sort(
        (a, b) =>
          (a.basis === b.basis ? 0 : a.basis === 'reported' ? -1 : 1) ||
          b.confidence - a.confidence ||
          `${a.src}|${a.dst}|${a.rel}`.localeCompare(`${b.src}|${b.dst}|${b.rel}`),
      );
      for (const e of adj) {
        const other = e.src === cur ? e.dst : e.src;
        if (!seen.has(other)) {
          if (seen.size >= limit) continue;
          const node = ix.byId.get(other);
          if (!node) continue;
          seen.set(other, node);
          next.push(other);
        }
        edges.set(`${e.src}|${e.dst}|${e.rel}`, e);
      }
    }
    frontier = next;
  }
  return { nodes: [...seen.values()], edges: [...edges.values()] };
}

export function createStaticApi(load: () => Promise<Snapshot>): Api {
  let index: Promise<Index> | null = null;
  const ix = () => (index ??= load().then(indexSnapshot).catch((err) => {
    index = null; // allow a retry after a failed download
    throw err;
  }));
  return {
    mode: 'static',
    feed: async (f, before) => queryFeed(await ix(), f, before),
    map: async (f) => queryMap(await ix(), f),
    timeline: async (f, buckets) => queryTimeline(await ix(), f, buckets),
    node: async (id) => queryNode(await ix(), id),
    graph: async (id, depth) => queryGraph(await ix(), id, depth),
    sources: async (): Promise<SourcesResponse> => {
      const { snap } = await ix();
      return { sources: snap.sources, ingest: { running: false, last: null }, generatedAt: snap.generatedAt };
    },
    startIngest: async () => {
      throw new Error('This is a static snapshot; it is refreshed automatically by GitHub Actions.');
    },
  };
}
