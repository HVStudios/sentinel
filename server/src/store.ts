import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Batch, NodeType, SentinelEdge, SentinelNode, SourceMeta } from './types.ts';
import { TIMED_TYPES } from './types.ts';

const SCHEMA = `
create table if not exists nodes (
  id text primary key,
  type text not null,
  title text not null,
  summary text,
  url text,
  category text,
  occurred_at text,
  published_at text,
  updated_at text,
  ingested_at text not null,
  lat real,
  lon real,
  country text,
  geo_basis text check (geo_basis in ('coordinates', 'publisher_country')),
  severity real,
  attrs text not null default '{}'
);
create index if not exists nodes_type_time on nodes (type, occurred_at);
create index if not exists nodes_time on nodes (occurred_at);

create table if not exists edges (
  src text not null,
  dst text not null,
  rel text not null,
  basis text not null check (basis in ('reported', 'inferred')),
  confidence real not null,
  rationale text,
  source_id text not null,
  observed_at text not null,
  primary key (src, dst, rel)
);
create index if not exists edges_dst on edges (dst);

create table if not exists provenance (
  node_id text not null,
  source_id text not null,
  source_url text,
  fetched_at text not null,
  primary key (node_id, source_id)
);

create table if not exists sources (
  id text primary key,
  name text not null,
  homepage text not null,
  description text not null,
  last_run_at text,
  last_status text,
  last_count integer,
  last_error text,
  last_duration_ms integer
);
`;

export interface NodeRow extends SentinelNode {
  ingestedAt: string;
  attrs: Record<string, unknown>;
}

export interface EdgeRow extends SentinelEdge {
  observedAt: string;
}

export interface SourceRow extends SourceMeta {
  lastRunAt: string | null;
  lastStatus: 'ok' | 'error' | null;
  lastCount: number | null;
  lastError: string | null;
  lastDurationMs: number | null;
}

export interface TimeQuery {
  from?: string;
  to?: string;
  types?: NodeType[];
}

/**
 * - `latest`: strictly chronological.
 * - `mixed`: takes from each category in turn, newest first within each, so one busy
 *   category cannot crowd out the others.
 * - `top`: like `mixed`, but each category is ordered by severity/rank first.
 */
export type FeedSort = 'latest' | 'mixed' | 'top';
export const FEED_SORTS: readonly FeedSort[] = ['latest', 'mixed', 'top'];

export interface FeedQuery extends TimeQuery {
  q?: string;
  limit?: number;
  sort?: FeedSort;
  /** Cursor from a previous page: `${occurredAt}|${id}` for latest, `mix:type=offset,…` otherwise. */
  before?: string;
}

/** `mix:vulnerability=12,article=5` ⇄ per-type offsets. Unknown or malformed input starts over. */
export const encodeMixCursor = (offsets: Record<string, number>): string =>
  `mix:${Object.entries(offsets).map(([t, n]) => `${t}=${n}`).join(',')}`;
export const decodeMixCursor = (cursor: string | undefined): Record<string, number> => {
  const out: Record<string, number> = {};
  if (!cursor?.startsWith('mix:')) return out;
  for (const part of cursor.slice(4).split(',')) {
    const [t, n] = part.split('=');
    if (t && TIMED_TYPES.includes(t as NodeType) && /^\d+$/.test(n ?? '')) out[t] = Number(n);
  }
  return out;
};

/**
 * Round-robin over per-type candidate lists (each already ordered and starting at that type's
 * offset, with one extra row to detect more). Shared semantics with web/src/staticApi.ts.
 */
export function interleave<T>(lists: { type: string; rows: T[]; offset: number; hasMore: boolean }[], limit: number) {
  const items: T[] = [];
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
  const offsets: Record<string, number> = {};
  lists.forEach((l, i) => { offsets[l.type] = l.offset + used[i]!; });
  return { items, nextCursor: more ? encodeMixCursor(offsets) : null };
}

type Row = Record<string, SQLInputValue>;

const toNode = (r: Row): NodeRow => ({
  id: r.id as string,
  type: r.type as NodeType,
  title: r.title as string,
  summary: r.summary as string | null,
  url: r.url as string | null,
  category: r.category as string | null,
  occurredAt: r.occurred_at as string | null,
  publishedAt: r.published_at as string | null,
  updatedAt: r.updated_at as string | null,
  ingestedAt: r.ingested_at as string,
  lat: r.lat as number | null,
  lon: r.lon as number | null,
  country: r.country as string | null,
  geoBasis: r.geo_basis as SentinelNode['geoBasis'],
  severity: r.severity as number | null,
  attrs: JSON.parse((r.attrs as string) || '{}'),
});

const toEdge = (r: Row): EdgeRow => ({
  src: r.src as string,
  dst: r.dst as string,
  rel: r.rel as string,
  basis: r.basis as SentinelEdge['basis'],
  confidence: r.confidence as number,
  rationale: r.rationale as string | null,
  sourceId: r.source_id as string,
  observedAt: r.observed_at as string,
});

const toSource = (r: Row): SourceRow => ({
  id: r.id as string,
  name: r.name as string,
  homepage: r.homepage as string,
  description: r.description as string,
  lastRunAt: r.last_run_at as string | null,
  lastStatus: r.last_status as SourceRow['lastStatus'],
  lastCount: r.last_count as number | null,
  lastError: r.last_error as string | null,
  lastDurationMs: r.last_duration_ms as number | null,
});

const n = <T>(v: T | undefined): T | null => (v === undefined ? null : v);

export class Store {
  readonly db: DatabaseSync;
  private readonly now: () => string;

  constructor(path = ':memory:', now: () => string = () => new Date().toISOString()) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('pragma journal_mode = wal; pragma foreign_keys = on;');
    this.db.exec(SCHEMA);
    this.now = now;
  }

  close(): void {
    this.db.close();
  }

  transaction<T>(fn: () => T): T {
    this.db.exec('begin');
    try {
      const result = fn();
      this.db.exec('commit');
      return result;
    } catch (err) {
      this.db.exec('rollback');
      throw err;
    }
  }

  registerSource(meta: SourceMeta): void {
    this.db
      .prepare(
        `insert into sources (id, name, homepage, description) values (?, ?, ?, ?)
         on conflict (id) do update set name = excluded.name, homepage = excluded.homepage,
           description = excluded.description`,
      )
      .run(meta.id, meta.name, meta.homepage, meta.description);
  }

  recordSourceRun(id: string, run: { status: 'ok' | 'error'; count: number; error?: string; durationMs: number }): void {
    this.db
      .prepare(
        `update sources set last_run_at = ?, last_status = ?, last_count = ?, last_error = ?, last_duration_ms = ?
         where id = ?`,
      )
      .run(this.now(), run.status, run.count, run.error ?? null, run.durationMs, id);
  }

  /**
   * Writes a batch atomically. Existing nodes are merged: non-null incoming columns win,
   * null columns keep the stored value, and attrs are JSON-merged. An empty title means
   * "enrichment only, keep the stored title"; reference nodes keep the first title seen.
   */
  writeBatch(batch: Batch): void {
    const now = this.now();
    const upsertNode = this.db.prepare(
      `insert into nodes (id, type, title, summary, url, category, occurred_at, published_at, updated_at,
         ingested_at, lat, lon, country, geo_basis, severity, attrs)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       on conflict (id) do update set
         type = excluded.type,
         title = case when excluded.title = '' or nodes.type in ('vendor', 'product', 'weakness')
           then nodes.title else excluded.title end,
         summary = coalesce(excluded.summary, nodes.summary),
         url = coalesce(excluded.url, nodes.url),
         category = coalesce(excluded.category, nodes.category),
         occurred_at = coalesce(excluded.occurred_at, nodes.occurred_at),
         published_at = coalesce(excluded.published_at, nodes.published_at),
         updated_at = coalesce(excluded.updated_at, nodes.updated_at),
         lat = coalesce(excluded.lat, nodes.lat),
         lon = coalesce(excluded.lon, nodes.lon),
         country = coalesce(excluded.country, nodes.country),
         geo_basis = coalesce(excluded.geo_basis, nodes.geo_basis),
         severity = coalesce(excluded.severity, nodes.severity),
         attrs = json_patch(nodes.attrs, excluded.attrs)`,
    );
    const upsertEdge = this.db.prepare(
      `insert into edges (src, dst, rel, basis, confidence, rationale, source_id, observed_at)
       values (?, ?, ?, ?, ?, ?, ?, ?)
       on conflict (src, dst, rel) do update set
         basis = case when edges.basis = 'reported' then 'reported' else excluded.basis end,
         confidence = max(edges.confidence, excluded.confidence),
         rationale = coalesce(excluded.rationale, edges.rationale),
         source_id = excluded.source_id,
         observed_at = excluded.observed_at`,
    );
    const upsertProv = this.db.prepare(
      `insert into provenance (node_id, source_id, source_url, fetched_at) values (?, ?, ?, ?)
       on conflict (node_id, source_id) do update set
         source_url = coalesce(excluded.source_url, provenance.source_url), fetched_at = excluded.fetched_at`,
    );

    this.transaction(() => {
      for (const node of batch.nodes) {
        upsertNode.run(
          node.id, node.type, node.title, n(node.summary), n(node.url), n(node.category),
          n(node.occurredAt), n(node.publishedAt), n(node.updatedAt), now,
          n(node.lat), n(node.lon), n(node.country), n(node.geoBasis), n(node.severity),
          JSON.stringify(node.attrs ?? {}),
        );
      }
      for (const e of batch.edges) {
        upsertEdge.run(e.src, e.dst, e.rel, e.basis, e.confidence, n(e.rationale), e.sourceId, now);
      }
      for (const p of batch.provenance) {
        upsertProv.run(p.nodeId, p.sourceId, n(p.sourceUrl), now);
      }
    });
  }

  /** Replaces all inferred edges produced by the given source with a new set. */
  replaceInferredEdges(sourceId: string, edges: SentinelEdge[]): void {
    this.transaction(() => {
      this.db.prepare(`delete from edges where basis = 'inferred' and source_id = ?`).run(sourceId);
      this.writeEdgesOnly(edges);
    });
  }

  private writeEdgesOnly(edges: SentinelEdge[]): void {
    const now = this.now();
    const stmt = this.db.prepare(
      `insert into edges (src, dst, rel, basis, confidence, rationale, source_id, observed_at)
       values (?, ?, ?, ?, ?, ?, ?, ?) on conflict (src, dst, rel) do nothing`,
    );
    for (const e of edges) stmt.run(e.src, e.dst, e.rel, e.basis, e.confidence, n(e.rationale), e.sourceId, now);
  }

  getNode(id: string): NodeRow | undefined {
    const r = this.db.prepare('select * from nodes where id = ?').get(id) as Row | undefined;
    return r ? toNode(r) : undefined;
  }

  nodesByType(type: NodeType): NodeRow[] {
    return (this.db.prepare('select * from nodes where type = ?').all(type) as Row[]).map(toNode);
  }

  idsByType(type: NodeType): string[] {
    return (this.db.prepare('select id from nodes where type = ?').all(type) as Row[]).map((r) => r.id as string);
  }

  provenanceFor(id: string): (SourceMeta & { sourceUrl: string | null; fetchedAt: string })[] {
    const rows = this.db
      .prepare(
        `select s.id, s.name, s.homepage, s.description, p.source_url, p.fetched_at
         from provenance p join sources s on s.id = p.source_id where p.node_id = ? order by s.name`,
      )
      .all(id) as Row[];
    return rows.map((r) => ({
      id: r.id as string,
      name: r.name as string,
      homepage: r.homepage as string,
      description: r.description as string,
      sourceUrl: r.source_url as string | null,
      fetchedAt: r.fetched_at as string,
    }));
  }

  edgesOf(id: string): EdgeRow[] {
    return (this.db.prepare('select * from edges where src = ? or dst = ?').all(id, id) as Row[]).map(toEdge);
  }

  private timeWhere(q: TimeQuery, params: SQLInputValue[]): string {
    const types = q.types?.length ? q.types.filter((t) => TIMED_TYPES.includes(t)) : [...TIMED_TYPES];
    const clauses = [`type in (${types.map(() => '?').join(', ')})`, 'occurred_at is not null'];
    params.push(...types);
    if (q.from) {
      clauses.push('occurred_at >= ?');
      params.push(q.from);
    }
    if (q.to) {
      clauses.push('occurred_at <= ?');
      params.push(q.to);
    }
    return clauses.join(' and ');
  }

  private textWhere(q: FeedQuery, params: SQLInputValue[]): string {
    if (!q.q) return '';
    const like = `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    params.push(like, like, like);
    return ` and (title like ? escape '\\' or summary like ? escape '\\' or id like ? escape '\\')`;
  }

  feed(q: FeedQuery): { items: NodeRow[]; nextCursor: string | null } {
    const limit = Math.min(Math.max(q.limit ?? 50, 1), 200);
    if (q.sort === 'mixed' || q.sort === 'top') return this.feedMixed(q, limit);
    const params: SQLInputValue[] = [];
    let where = this.timeWhere(q, params) + this.textWhere(q, params);
    if (q.before) {
      const sep = q.before.lastIndexOf('|');
      where += ' and (occurred_at < ? or (occurred_at = ? and id < ?))';
      const t = q.before.slice(0, sep);
      params.push(t, t, q.before.slice(sep + 1));
    }
    const rows = this.db
      .prepare(`select * from nodes where ${where} order by occurred_at desc, id desc limit ?`)
      .all(...params, limit + 1) as Row[];
    const items = rows.slice(0, limit).map(toNode);
    const last = items.at(-1);
    return { items, nextCursor: rows.length > limit && last ? `${last.occurredAt}|${last.id}` : null };
  }

  private feedMixed(q: FeedQuery, limit: number) {
    const types = TIMED_TYPES.filter((t) => !q.types?.length || q.types.includes(t));
    const offsets = decodeMixCursor(q.before);
    const order = q.sort === 'top' ? 'coalesce(severity, -1) desc, occurred_at desc, id desc' : 'occurred_at desc, id desc';
    const lists = types.map((type) => {
      const params: SQLInputValue[] = [];
      const where = this.timeWhere({ ...q, types: [type] }, params) + this.textWhere(q, params);
      const offset = offsets[type] ?? 0;
      const rows = (this.db.prepare(`select * from nodes where ${where} order by ${order} limit ? offset ?`).all(...params, limit + 1, offset) as Row[]).map(toNode);
      return { type, rows: rows.slice(0, limit), offset, hasMore: rows.length > limit };
    });
    return interleave(lists, limit);
  }

  mapData(q: TimeQuery): { points: NodeRow[]; countries: { country: string; count: number }[] } {
    const p1: SQLInputValue[] = [];
    const points = (
      this.db
        .prepare(
          `select * from nodes where ${this.timeWhere(q, p1)} and geo_basis = 'coordinates'
           and lat is not null and lon is not null order by occurred_at desc limit 2000`,
        )
        .all(...p1) as Row[]
    ).map(toNode);
    const p2: SQLInputValue[] = [];
    const countries = (
      this.db
        .prepare(
          `select country, count(*) as count from nodes where ${this.timeWhere(q, p2)}
           and geo_basis = 'publisher_country' and country is not null group by country order by count desc`,
        )
        .all(...p2) as Row[]
    ).map((r) => ({ country: r.country as string, count: Number(r.count) }));
    return { points, countries };
  }

  /** Histogram of timed nodes in `buckets` equal-width bins over [from, to]. */
  timeline(q: TimeQuery & { from: string; to: string; buckets: number }): {
    from: string;
    to: string;
    bucketMs: number;
    series: Record<string, number[]>;
  } {
    const fromMs = Date.parse(q.from);
    const toMs = Date.parse(q.to);
    const bucketMs = Math.max(1, Math.ceil((toMs - fromMs) / q.buckets));
    const params: SQLInputValue[] = [];
    const where = this.timeWhere(q, params);
    const rows = this.db
      .prepare(
        `select type, cast(((julianday(occurred_at) - julianday(?)) * 86400000) / ? as integer) as b, count(*) as c
         from nodes where ${where} group by type, b`,
      )
      .all(q.from, bucketMs, ...params) as Row[];
    const series: Record<string, number[]> = {};
    for (const r of rows) {
      const b = Number(r.b);
      if (b < 0 || b >= q.buckets) continue;
      const arr = (series[r.type as string] ??= new Array<number>(q.buckets).fill(0));
      arr[b] = (arr[b] ?? 0) + Number(r.c);
    }
    return { from: q.from, to: q.to, bucketMs, series };
  }

  /** Breadth-first neighbourhood around `id`, capped at `limit` nodes. */
  graph(id: string, depth = 1, limit = 80): { nodes: NodeRow[]; edges: EdgeRow[] } {
    const root = this.getNode(id);
    if (!root) return { nodes: [], edges: [] };
    const seen = new Map<string, NodeRow>([[id, root]]);
    const edges = new Map<string, EdgeRow>();
    let frontier = [id];
    for (let d = 0; d < depth && frontier.length && seen.size < limit; d++) {
      const next: string[] = [];
      for (const cur of frontier) {
        // Prefer reported, high-confidence links when the neighbourhood must be truncated.
        const adj = this.edgesOf(cur).sort(
          (a, b) =>
            (a.basis === b.basis ? 0 : a.basis === 'reported' ? -1 : 1) ||
            b.confidence - a.confidence ||
            `${a.src}|${a.dst}|${a.rel}`.localeCompare(`${b.src}|${b.dst}|${b.rel}`),
        );
        for (const e of adj) {
          const other = e.src === cur ? e.dst : e.src;
          if (!seen.has(other)) {
            if (seen.size >= limit) continue;
            const node = this.getNode(other);
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

  /** Everything needed to answer API queries offline (see web/src/staticApi.ts). */
  snapshot(): { nodes: NodeRow[]; edges: EdgeRow[]; provenance: { nodeId: string; sourceId: string; sourceUrl: string | null; fetchedAt: string }[] } {
    return {
      nodes: (this.db.prepare('select * from nodes order by id').all() as Row[]).map(toNode),
      edges: (this.db.prepare('select * from edges order by src, dst, rel').all() as Row[]).map(toEdge),
      provenance: (this.db.prepare('select * from provenance order by node_id, source_id').all() as Row[]).map((r) => ({
        nodeId: r.node_id as string,
        sourceId: r.source_id as string,
        sourceUrl: r.source_url as string | null,
        fetchedAt: r.fetched_at as string,
      })),
    };
  }

  sources(): SourceRow[] {
    return (this.db.prepare('select * from sources order by name').all() as Row[]).map(toSource);
  }

  counts(): Record<string, number> {
    const rows = this.db.prepare('select type, count(*) as c from nodes group by type').all() as Row[];
    const out: Record<string, number> = {};
    for (const r of rows) out[r.type as string] = Number(r.c);
    out.edges = Number((this.db.prepare('select count(*) as c from edges').get() as Row).c);
    return out;
  }
}
