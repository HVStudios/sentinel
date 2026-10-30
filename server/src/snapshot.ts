import type { Store } from './store.ts';
import { VERSION } from './version.ts';

export const SNAPSHOT_FORMAT = 1;

/** A self-contained, attributed copy of the store for the static (GitHub Pages) build. */
export function buildSnapshot(store: Store, now: () => Date = () => new Date()) {
  return {
    format: SNAPSHOT_FORMAT,
    version: VERSION,
    generatedAt: now().toISOString(),
    sources: store.sources(),
    ...store.snapshot(),
  };
}

export type Snapshot = ReturnType<typeof buildSnapshot>;
