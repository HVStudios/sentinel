import { productNodeId, vendorNodeId } from './ids.ts';

/**
 * Trends, computed identically by the server (`GET /api/trends`) and the static Pages build.
 *
 * Two kinds of history, labelled differently in the UI:
 * - CISA KEV: every catalogue entry carries the date CISA added it and KEV entries are never
 *   expired, so KEV trends cover the catalogue's full history;
 * - news and world events: only what SENTINEL has collected (since `collectedSince`), minus what
 *   retention has expired. These are activity counts of SENTINEL's collection, not of the world.
 */
export interface TrendNode {
  id: string;
  type: string;
  category?: string | null;
  occurredAt?: string | null;
  ingestedAt?: string;
  attrs?: Record<string, unknown>;
}

export interface TrendsInput {
  nodes: TrendNode[];
  /** vulnerability id → weakness ids (CWE) it has. */
  weaknessesOf: Map<string, string[]>;
  now: Date;
  windowDays: number;
}

export interface Ranked {
  id: string;
  name: string;
  count: number;
}

export interface Trends {
  windowDays: number;
  weeks: string[];
  kevWeekly: { total: number[]; ransomware: number[] };
  kevInWindow: number;
  ransomwareInWindow: number;
  topVendors: Ranked[];
  topProducts: Ranked[];
  topWeaknesses: Ranked[];
  collectedSince: string | null;
  collectedWeekly: { article: number[]; natural_event: number[] };
}

export const WEEKS = 52;
const TOP = 10;
const DAY = 86_400_000;

/** Monday 00:00 UTC of the week containing `d`. */
export function weekStart(d: Date): Date {
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
}

interface Kev {
  dateAdded?: string;
  ransomware?: string;
  vendorProject?: string;
  product?: string;
}

function rank(counts: Map<string, { name: string; count: number }>): Ranked[] {
  return [...counts]
    .map(([id, v]) => ({ id, name: v.name, count: v.count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, TOP);
}

export function computeTrends({ nodes, weaknessesOf, now, windowDays }: TrendsInput): Trends {
  const first = weekStart(new Date(now.getTime() - (WEEKS - 1) * 7 * DAY));
  const weeks = Array.from({ length: WEEKS }, (_, i) => new Date(first.getTime() + i * 7 * DAY).toISOString().slice(0, 10));
  const weekIndex = (iso: string) => Math.floor((weekStart(new Date(iso)).getTime() - first.getTime()) / (7 * DAY));
  const windowStart = new Date(now.getTime() - windowDays * DAY).toISOString();
  const nowIso = now.toISOString();

  const kevTotal = new Array<number>(WEEKS).fill(0);
  const kevRansomware = new Array<number>(WEEKS).fill(0);
  const vendors = new Map<string, { name: string; count: number }>();
  const products = new Map<string, { name: string; count: number }>();
  const weaknesses = new Map<string, { name: string; count: number }>();
  const bump = (m: Map<string, { name: string; count: number }>, id: string, name: string) =>
    m.set(id, { name, count: (m.get(id)?.count ?? 0) + 1 });
  let kevInWindow = 0;
  let ransomwareInWindow = 0;

  const collected = { article: new Array<number>(WEEKS).fill(0), natural_event: new Array<number>(WEEKS).fill(0) };
  let collectedSince: string | null = null;

  for (const n of nodes) {
    if (n.ingestedAt && (collectedSince === null || n.ingestedAt < collectedSince)) collectedSince = n.ingestedAt;
    const kev = n.attrs?.kev as Kev | undefined;
    if (n.type === 'vulnerability' && kev?.dateAdded) {
      const added = `${kev.dateAdded}T00:00:00.000Z`;
      if (added > nowIso) continue;
      const w = weekIndex(added);
      const ransomware = kev.ransomware === 'Known';
      if (w >= 0 && w < WEEKS) {
        kevTotal[w]! += 1;
        if (ransomware) kevRansomware[w]! += 1;
      }
      if (added >= windowStart) {
        kevInWindow++;
        if (ransomware) ransomwareInWindow++;
        if (kev.vendorProject) bump(vendors, vendorNodeId(kev.vendorProject), kev.vendorProject.trim());
        if (kev.vendorProject && kev.product) bump(products, productNodeId(kev.vendorProject, kev.product), `${kev.vendorProject.trim()} ${kev.product.trim()}`);
        for (const cwe of weaknessesOf.get(n.id) ?? []) bump(weaknesses, cwe, cwe.replace(/^cwe:/, ''));
      }
    } else if ((n.type === 'article' || n.type === 'natural_event') && n.occurredAt && n.occurredAt <= nowIso) {
      const w = weekIndex(n.occurredAt);
      if (w >= 0 && w < WEEKS) collected[n.type][w]! += 1;
    }
  }

  return {
    windowDays,
    weeks,
    kevWeekly: { total: kevTotal, ransomware: kevRansomware },
    kevInWindow,
    ransomwareInWindow,
    topVendors: rank(vendors),
    topProducts: rank(products),
    topWeaknesses: rank(weaknesses),
    collectedSince,
    collectedWeekly: collected,
  };
}
