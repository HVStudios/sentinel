import type { Store } from './store.ts';

/**
 * How long items are kept. The database now persists between runs (locally and in the Pages
 * workflow), so without expiry it grows by several hundred items a day and every visitor of the
 * static site downloads all of it.
 *
 * - articles: 90 days (the longest feed preset that matters for news);
 * - world events: 180 days;
 * - vulnerabilities not in CISA KEV (recent NVD and GitHub-only advisories): 14 days. NVD adds about
 *   250 notable (CVSS ≥ 7) CVEs a day; 90 days would mean ~22,000 entries and a 20+ MB snapshot;
 * - KEV-listed vulnerabilities: kept indefinitely (the catalogue is small and is the core of the "1y" view);
 * - products, vendors and weaknesses that no longer have any relationship are removed.
 * Stories are rebuilt after pruning, so they never point at expired items.
 */
export const RETENTION_DAYS = { article: 90, natural_event: 180, vulnerability: 14 } as const;

export function pruneExpired(store: Store, now: Date = new Date()): { expired: number; orphans: number } {
  const cutoff = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
  const expired = store.db
    .prepare(
      `select id from nodes where occurred_at is not null and (
         (type = 'article' and occurred_at < ?) or
         (type = 'natural_event' and occurred_at < ?) or
         (type = 'vulnerability' and occurred_at < ? and json_extract(attrs, '$.kev') is null)
       )`,
    )
    .all(cutoff(RETENTION_DAYS.article), cutoff(RETENTION_DAYS.natural_event), cutoff(RETENTION_DAYS.vulnerability))
    .map((r) => (r as { id: string }).id);
  return store.transaction(() => {
    store.deleteNodesInTransaction(expired);
    return { expired: expired.length, orphans: store.deleteOrphanReferenceNodesInTransaction() };
  });
}
