import type { NodeRow, Store } from './store.ts';
import { VERSION } from './version.ts';
import { RETENTION_DAYS } from './retention.ts';

/**
 * Format 2 is a compact encoding of the store for the static (GitHub Pages) build; the browser
 * expands it back to the same shapes (web/src/staticApi.ts), so the UI and the parity tests are
 * unaffected. Only presentation-redundant data is dropped:
 * - edges and provenance become tuples, without the unused `observedAt`;
 * - a provenance URL equal to its source's homepage is omitted (the UI links the homepage anyway);
 * - null fields are omitted;
 * - NVD reference lists are cut to the first few (the full count is kept; the NVD link has them all);
 * - a KEV description identical to the node summary is not repeated.
 */
export const SNAPSHOT_FORMAT = 2;
export const MAX_REFERENCES = 5;
/** The export warns above this size (uncompressed); visitors download the whole file. */
export const SNAPSHOT_BUDGET_BYTES = 12_000_000;

/** [src, dst, rel, 'r' | 'i', confidence, rationale | null, sourceId] */
export type CompactEdge = [string, string, string, 'r' | 'i', number, string | null, string];
/** [nodeId, sourceId, sourceUrl | null, fetchedAt] */
export type CompactProvenance = [string, string, string | null, string];

function compactNode(n: NodeRow): Record<string, unknown> {
  const attrs: Record<string, unknown> = { ...n.attrs };
  const nvd = attrs.nvd as { references?: unknown[] } | undefined;
  if (nvd?.references && nvd.references.length > MAX_REFERENCES) {
    attrs.nvd = { ...nvd, references: nvd.references.slice(0, MAX_REFERENCES), referenceCount: nvd.references.length };
  }
  const kev = attrs.kev as { description?: string } | undefined;
  if (kev?.description && kev.description === n.summary) {
    const { description: _dup, ...rest } = kev;
    attrs.kev = rest;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries({ ...n, attrs })) if (v !== null && v !== undefined) out[k] = v;
  return out;
}

export function buildSnapshot(store: Store, now: () => Date = () => new Date()) {
  const { nodes, edges, provenance } = store.snapshot();
  const sources = store.sources();
  const homepage = new Map(sources.map((s) => [s.id, s.homepage]));
  return {
    format: SNAPSHOT_FORMAT,
    version: VERSION,
    generatedAt: now().toISOString(),
    retention: RETENTION_DAYS,
    sources,
    nodes: nodes.map(compactNode),
    edges: edges.map((e): CompactEdge => [e.src, e.dst, e.rel, e.basis === 'reported' ? 'r' : 'i', e.confidence, e.rationale ?? null, e.sourceId]),
    provenance: provenance.map(
      (p): CompactProvenance => [p.nodeId, p.sourceId, p.sourceUrl && p.sourceUrl !== homepage.get(p.sourceId) ? p.sourceUrl : null, p.fetchedAt],
    ),
  };
}

export type Snapshot = ReturnType<typeof buildSnapshot>;
