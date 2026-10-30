export type NodeType = 'vulnerability' | 'natural_event' | 'article' | 'vendor' | 'product' | 'weakness' | 'source';
export type TimedType = 'vulnerability' | 'natural_event' | 'article';
export const TIMED_TYPES: TimedType[] = ['vulnerability', 'natural_event', 'article'];

export interface SNode {
  id: string;
  type: NodeType;
  title: string;
  summary: string | null;
  url: string | null;
  category: string | null;
  occurredAt: string | null;
  publishedAt: string | null;
  updatedAt: string | null;
  ingestedAt: string;
  lat: number | null;
  lon: number | null;
  country: string | null;
  geoBasis: 'coordinates' | 'publisher_country' | null;
  severity: number | null;
  attrs: Record<string, any>;
}

export interface SEdge {
  src: string;
  dst: string;
  rel: string;
  basis: 'reported' | 'inferred';
  confidence: number;
  rationale: string | null;
  sourceId: string;
  observedAt: string;
}

export interface NodeDetail {
  node: SNode;
  provenance: { id: string; name: string; homepage: string; description: string; sourceUrl: string | null; fetchedAt: string }[];
  edges: (SEdge & { direction: 'in' | 'out'; other: { id: string; type: NodeType | null; title: string; occurredAt?: string | null } })[];
}

export interface SourceStatus {
  id: string;
  name: string;
  homepage: string;
  description: string;
  lastRunAt: string | null;
  lastStatus: 'ok' | 'error' | null;
  lastCount: number | null;
  lastError: string | null;
  lastDurationMs: number | null;
}

/** See server/src/store.ts: latest = chronological; mixed/top = one category at a time, by time or rank. */
export type FeedSort = 'latest' | 'mixed' | 'top';

export interface Filters {
  from?: string;
  to?: string;
  types: TimedType[];
  q?: string;
  sort?: FeedSort;
}

const qs = (params: Record<string, string | number | undefined>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') s.set(k, String(v));
  const out = s.toString();
  return out ? `?${out}` : '';
};

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, { signal, headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${path}`);
  return (await res.json()) as T;
}

const timeParams = (f: Filters) => ({ from: f.from, to: f.to, types: f.types.join(',') || undefined });

export interface SourcesResponse {
  sources: SourceStatus[];
  ingest: { running: boolean; last: { startedAt: string; finishedAt?: string; error?: string } | null };
  /** Set in static mode: when the snapshot was exported. */
  generatedAt?: string;
}

export interface Api {
  /** `live` talks to the local server; `static` answers from a bundled snapshot (GitHub Pages). */
  mode: 'live' | 'static';
  feed(f: Filters, before?: string, signal?: AbortSignal): Promise<{ items: SNode[]; nextCursor: string | null }>;
  map(f: Filters, signal?: AbortSignal): Promise<{ points: SNode[]; countries: { country: string; count: number }[] }>;
  timeline(
    f: Filters & { from: string; to: string },
    buckets: number,
    signal?: AbortSignal,
  ): Promise<{ from: string; to: string; bucketMs: number; series: Partial<Record<TimedType, number[]>> }>;
  node(id: string, signal?: AbortSignal): Promise<NodeDetail>;
  graph(id: string, depth: number, signal?: AbortSignal): Promise<{ nodes: SNode[]; edges: SEdge[] }>;
  sources(signal?: AbortSignal): Promise<SourcesResponse>;
  startIngest(): Promise<void>;
}

export const httpApi: Api = {
  mode: 'live',
  feed: (f, before, signal) =>
    get<{ items: SNode[]; nextCursor: string | null }>(`/api/feed${qs({ ...timeParams(f), q: f.q, sort: f.sort, before, limit: 50 })}`, signal),
  map: (f, signal) =>
    get<{ points: SNode[]; countries: { country: string; count: number }[] }>(`/api/map${qs(timeParams(f))}`, signal),
  timeline: (f, buckets, signal) =>
    get<{ from: string; to: string; bucketMs: number; series: Partial<Record<TimedType, number[]>> }>(
      `/api/timeline${qs({ ...timeParams(f), buckets })}`,
      signal,
    ),
  node: (id, signal) => get<NodeDetail>(`/api/nodes/${encodeURIComponent(id)}`, signal),
  graph: (id, depth, signal) =>
    get<{ nodes: SNode[]; edges: SEdge[] }>(`/api/graph/${encodeURIComponent(id)}${qs({ depth, limit: 60 })}`, signal),
  sources: (signal?: AbortSignal) => get<SourcesResponse>('/api/sources', signal),
  startIngest: async () => {
    const res = await fetch('/api/ingest', { method: 'POST' });
    if (!res.ok && res.status !== 409) throw new Error(`Refresh unavailable (${res.status})`);
  },
};
