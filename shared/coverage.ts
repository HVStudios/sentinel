/**
 * Who reported a vulnerability: the articles and advisories that mention it, grouped by the
 * country of the publishing outlet or agency. Publisher country is where the publisher is based,
 * never where the vulnerability "is". Shared by the server API and the static build.
 */

interface CoverageNode<T extends string> {
  id: string;
  type: T;
  title: string;
  occurredAt?: string | null;
  category?: string | null;
  country?: string | null;
  geoBasis?: string | null;
  attrs?: Record<string, unknown> | null;
}

/** The fields of a linked node that a detail view needs (the `other` side of each edge). */
export interface EdgeOther<T extends string = string> {
  id: string;
  type: T | null;
  title: string;
  occurredAt?: string | null;
  category?: string | null;
  /** Articles only: the publisher's country, as configured in the feed registry. */
  publisherCountry?: string | null;
  outlet?: string | null;
}

export function edgeOther<T extends string>(node: CoverageNode<T> | null | undefined, id: string): EdgeOther<T> {
  if (!node) return { id, type: null, title: id };
  const other: EdgeOther<T> = { id: node.id, type: node.type, title: node.title, occurredAt: node.occurredAt ?? null };
  if (node.type === 'article') {
    const a = node.attrs ?? {};
    other.category = node.category ?? null;
    other.publisherCountry = node.geoBasis === 'publisher_country' ? (node.country ?? null) : null;
    other.outlet = typeof a.outlet === 'string' ? a.outlet : typeof a.domain === 'string' ? a.domain : null;
  }
  return other;
}

interface CoverageEdge {
  rel: string;
  direction: 'in' | 'out';
  basis: 'reported' | 'inferred';
  confidence: number;
  rationale: string | null;
  other: EdgeOther;
}

export interface CoverageItem {
  id: string;
  title: string;
  outlet: string | null;
  advisory: boolean;
  occurredAt: string | null;
  basis: 'reported' | 'inferred';
  confidence: number;
  rationale: string | null;
}

export interface CoverageGroup {
  /** null: the publisher's country is not known (e.g. Hacker News, some GDELT results). */
  country: string | null;
  items: CoverageItem[];
}

/** Groups with the most items first (unknown country last); items oldest first, so the first report leads. */
export function coverageByCountry(edges: CoverageEdge[]): CoverageGroup[] {
  const groups = new Map<string | null, CoverageItem[]>();
  for (const e of edges) {
    if (e.rel !== 'mentions' || e.direction !== 'in' || e.other.type !== 'article') continue;
    const country = e.other.publisherCountry ?? null;
    const item: CoverageItem = {
      id: e.other.id,
      title: e.other.title,
      outlet: e.other.outlet ?? null,
      advisory: e.other.category === 'advisory',
      occurredAt: e.other.occurredAt ?? null,
      basis: e.basis,
      confidence: e.confidence,
      rationale: e.rationale,
    };
    groups.set(country, [...(groups.get(country) ?? []), item]);
  }
  return [...groups]
    .map(([country, items]) => ({ country, items: items.sort((a, b) => (a.occurredAt ?? '').localeCompare(b.occurredAt ?? '')) }))
    .sort((a, b) => Number(a.country === null) - Number(b.country === null) || b.items.length - a.items.length || a.country!.localeCompare(b.country!));
}
