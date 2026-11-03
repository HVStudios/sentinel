export type NodeType = 'vulnerability' | 'natural_event' | 'article' | 'vendor' | 'product' | 'weakness' | 'source' | 'story';
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
  edges: (SEdge & { direction: 'in' | 'out'; other: EdgeOther<NodeType> })[];
}

/** Where a vendor is headquartered according to Wikidata. Not the location of any vulnerability or attack. */
export interface VendorHq {
  id: string;
  title: string;
  lat: number;
  lon: number;
  hq: string;
  country: string | null;
  qid: string;
  url: string;
  matchedBy: string;
  confidence: number;
  vulnerabilities: number;
}

import type { EdgeOther } from '../../shared/coverage.ts';
export type { Trends } from '../../shared/trends.ts';
import type { Trends } from '../../shared/trends.ts';

export type { AffectedCountry } from '../../shared/affected.ts';
import type { AffectedCountry } from '../../shared/affected.ts';

export type MapData = { points: SNode[]; countries: { country: string; count: number }[]; vendors: VendorHq[]; affected: AffectedCountry[] };

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
  /** Recent runs, oldest first (absent in older snapshots). */
  runs?: SourceRun[];
}

export interface SourceRun {
  at: string;
  status: 'ok' | 'error';
  count: number;
  durationMs: number;
  /** Error, or warnings for an `ok` run with partial problems. */
  error?: string;
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
  ingest: {
    running: boolean;
    last: { startedAt: string; finishedAt?: string; error?: string; trigger?: 'manual' | 'scheduled' } | null;
    /** Live server only: automatic refresh interval and next run. */
    refreshMinutes?: number | null;
    nextRunAt?: string | null;
  };
  /** Set in static mode: when the snapshot was exported. */
  generatedAt?: string;
  /** How many days items are kept, by type (vulnerabilities: those not listed in CISA KEV). */
  retention?: { article: number; natural_event: number; vulnerability: number };
}

export interface Api {
  /** `live` talks to the local server; `static` answers from a bundled snapshot (GitHub Pages). */
  mode: 'live' | 'static';
  feed(f: Filters, before?: string, signal?: AbortSignal): Promise<{ items: SNode[]; nextCursor: string | null }>;
  map(f: Filters, signal?: AbortSignal): Promise<MapData>;
  timeline(
    f: Filters & { from: string; to: string },
    buckets: number,
    signal?: AbortSignal,
  ): Promise<{ from: string; to: string; bucketMs: number; series: Partial<Record<TimedType, number[]>> }>;
  node(id: string, signal?: AbortSignal): Promise<NodeDetail>;
  graph(id: string, depth: number, signal?: AbortSignal): Promise<{ nodes: SNode[]; edges: SEdge[] }>;
  sources(signal?: AbortSignal): Promise<SourcesResponse>;
  stories(f: Pick<Filters, 'from' | 'to'>, signal?: AbortSignal): Promise<{ stories: SNode[] }>;
  /** Timed items related to a watched node, each with `via` explaining the link. */
  related(id: string, signal?: AbortSignal): Promise<{ items: (SNode & { via: string })[] }>;
  /** KEV history (complete) and SENTINEL's collection activity, for a 30/90/365-day ranking window. */
  trends(windowDays: number, signal?: AbortSignal): Promise<Trends>;
  startIngest(): Promise<void>;
}

export const httpApi: Api = {
  mode: 'live',
  feed: (f, before, signal) =>
    get<{ items: SNode[]; nextCursor: string | null }>(`/api/feed${qs({ ...timeParams(f), q: f.q, sort: f.sort, before, limit: 50 })}`, signal),
  map: (f, signal) =>
    get<MapData>(`/api/map${qs(timeParams(f))}`, signal),
  timeline: (f, buckets, signal) =>
    get<{ from: string; to: string; bucketMs: number; series: Partial<Record<TimedType, number[]>> }>(
      `/api/timeline${qs({ ...timeParams(f), buckets })}`,
      signal,
    ),
  node: (id, signal) => get<NodeDetail>(`/api/nodes/${encodeURIComponent(id)}`, signal),
  graph: (id, depth, signal) =>
    get<{ nodes: SNode[]; edges: SEdge[] }>(`/api/graph/${encodeURIComponent(id)}${qs({ depth, limit: 60 })}`, signal),
  sources: (signal?: AbortSignal) => get<SourcesResponse>('/api/sources', signal),
  trends: (windowDays, signal) => get<Trends>(`/api/trends${qs({ window: windowDays })}`, signal),
  related: (id, signal) => get<{ items: (SNode & { via: string })[] }>(`/api/related/${encodeURIComponent(id)}`, signal),
  stories: (f, signal) => get<{ stories: SNode[] }>(`/api/stories${qs({ from: f.from, to: f.to, limit: 100 })}`, signal),
  startIngest: async () => {
    const res = await fetch('/api/ingest', { method: 'POST' });
    if (!res.ok && res.status !== 409) throw new Error(`Refresh unavailable (${res.status})`);
  },
};
