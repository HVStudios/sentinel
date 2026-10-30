export type NodeType =
  | 'vulnerability'
  | 'natural_event'
  | 'article'
  | 'vendor'
  | 'product'
  | 'weakness'
  | 'source';

/** Node types that are bound to a point in time and appear in the feed, timeline and map. */
export const TIMED_TYPES: readonly NodeType[] = ['vulnerability', 'natural_event', 'article'];

/**
 * Why a node has a location:
 * - `coordinates`: the source supplies lat/lon for the event itself.
 * - `publisher_country`: the source supplies the publishing outlet's country, not the event's location.
 */
export type GeoBasis = 'coordinates' | 'publisher_country';

export interface SentinelNode {
  id: string;
  type: NodeType;
  title: string;
  summary?: string | null;
  url?: string | null;
  category?: string | null;
  occurredAt?: string | null;
  publishedAt?: string | null;
  updatedAt?: string | null;
  lat?: number | null;
  lon?: number | null;
  country?: string | null;
  geoBasis?: GeoBasis | null;
  /** Normalised 0–1 ranking value; raw metrics live in attrs. */
  severity?: number | null;
  attrs?: Record<string, unknown>;
}

export type EdgeBasis = 'reported' | 'inferred';

export interface SentinelEdge {
  src: string;
  dst: string;
  rel: string;
  basis: EdgeBasis;
  confidence: number;
  rationale?: string | null;
  sourceId: string;
}

export interface Provenance {
  nodeId: string;
  sourceId: string;
  sourceUrl?: string | null;
}

export interface Batch {
  nodes: SentinelNode[];
  edges: SentinelEdge[];
  provenance: Provenance[];
}

export interface SourceMeta {
  id: string;
  name: string;
  homepage: string;
  description: string;
}

export const emptyBatch = (): Batch => ({ nodes: [], edges: [], provenance: [] });
