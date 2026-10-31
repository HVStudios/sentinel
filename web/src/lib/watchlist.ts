import { useCallback, useEffect, useMemo, useState } from 'react';
import type { NodeType, SNode } from '../api.ts';
import { api } from '../apiClient.ts';

/**
 * The watchlist lives only in this browser (localStorage); there are no accounts. A watch
 * remembers when it was last checked, and related items SENTINEL first saw after that are "new".
 */
export interface Watch {
  id: string;
  type: NodeType;
  title: string;
  addedAt: string;
  lastSeenAt: string;
}

export const WATCHABLE: NodeType[] = ['vendor', 'product', 'vulnerability', 'weakness', 'story'];
export const STORAGE_KEY = 'sentinel.watchlist.v1';

const isWatch = (w: unknown): w is Watch =>
  typeof w === 'object' && w !== null && ['id', 'type', 'title', 'addedAt', 'lastSeenAt'].every((k) => typeof (w as Record<string, unknown>)[k] === 'string');

export function loadWatchlist(): Watch[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter(isWatch) : [];
  } catch {
    // Private windows or blocked storage: start empty rather than failing.
    return [];
  }
}

function saveWatchlist(list: Watch[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // Storage unavailable: the watchlist still works for this session.
  }
}

export function useWatchlist(now: () => Date = () => new Date()) {
  const [watches, setWatches] = useState<Watch[]>(loadWatchlist);

  // Keep several open tabs in sync.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => e.key === STORAGE_KEY && setWatches(loadWatchlist());
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const update = useCallback((fn: (list: Watch[]) => Watch[]) => {
    setWatches((cur) => {
      const next = fn(cur);
      saveWatchlist(next);
      return next;
    });
  }, []);

  const isWatched = useCallback((id: string) => watches.some((w) => w.id === id), [watches]);

  const toggle = useCallback(
    (node: Pick<SNode, 'id' | 'type' | 'title'>) => {
      const at = now().toISOString();
      update((list) =>
        list.some((w) => w.id === node.id)
          ? list.filter((w) => w.id !== node.id)
          : [...list, { id: node.id, type: node.type, title: node.title, addedAt: at, lastSeenAt: at }],
      );
    },
    [now, update],
  );

  const markSeen = useCallback(
    (id?: string) => {
      const at = now().toISOString();
      update((list) => list.map((w) => (id === undefined || w.id === id ? { ...w, lastSeenAt: at } : w)));
    },
    [now, update],
  );

  const remove = useCallback((id: string) => update((list) => list.filter((w) => w.id !== id)), [update]);

  return { watches, isWatched, toggle, markSeen, remove };
}

export type RelatedItem = SNode & { via: string };

export interface WatchStatus {
  watch: Watch;
  items: RelatedItem[];
  isNew: (item: SNode) => boolean;
  newCount: number;
  error?: string;
}

/** Fetches related items for every watch and works out which are new since each was last checked. */
export function useWatchData(watches: Watch[]) {
  const [data, setData] = useState<Record<string, { items: RelatedItem[]; error?: string }>>({});
  const ids = watches.map((w) => w.id).join('\n');

  useEffect(() => {
    const ctrl = new AbortController();
    const list = ids ? ids.split('\n') : [];
    Promise.all(
      list.map(async (id) => {
        try {
          return [id, { items: (await api.related(id, ctrl.signal)).items }] as const;
        } catch (err) {
          return [id, { items: [], error: (err as Error).message }] as const;
        }
      }),
    ).then((entries) => !ctrl.signal.aborted && setData(Object.fromEntries(entries)));
    return () => ctrl.abort();
  }, [ids]);

  return useMemo(() => {
    const statuses: WatchStatus[] = watches.map((watch) => {
      const d = data[watch.id];
      // "New" = first seen by SENTINEL after this watch was last checked.
      const isNew = (item: SNode) => item.ingestedAt > watch.lastSeenAt;
      const items = d?.items ?? [];
      return { watch, items, isNew, newCount: items.filter(isNew).length, error: d?.error };
    });
    // Feed highlight: item id → titles of the watches it relates to.
    const hits = new Map<string, string[]>();
    for (const s of statuses) for (const item of s.items) hits.set(item.id, [...(hits.get(item.id) ?? []), s.watch.title]);
    return { statuses, hits, totalNew: statuses.reduce((n, s) => n + s.newCount, 0) };
  }, [watches, data]);
}
