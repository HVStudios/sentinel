import { useEffect, useRef, useState } from 'react';
import type { Api, SourcesResponse } from '../api.ts';

export const IDLE_POLL_MS = 60_000;
export const RUNNING_POLL_MS = 2_000;

/**
 * Live mode only: watches the server's ingest status so the page can reload its data when a
 * refresh (manual or scheduled) finishes. `version` changes exactly when a refresh completes; add
 * it to data request keys to refetch. The static Pages build never polls (its data is a snapshot).
 */
export function useDataVersion(api: Pick<Api, 'mode' | 'sources'>) {
  const [ingest, setIngest] = useState<SourcesResponse['ingest'] | null>(null);
  const [version, setVersion] = useState('');
  // Read the fetcher through a ref so callers passing a new object each render don't restart polling.
  const sources = useRef(api.sources);
  sources.current = api.sources;

  useEffect(() => {
    if (api.mode !== 'live') return;
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;
    // undefined until the first answer: that one only records the current state.
    let lastFinished: string | undefined;
    const poll = async () => {
      let running = false;
      try {
        const res = await sources.current();
        if (cancelled) return;
        running = res.ingest.running;
        setIngest(res.ingest);
        const finished = res.ingest.last?.finishedAt ?? '';
        if (lastFinished !== undefined && finished && finished !== lastFinished) setVersion(finished);
        lastFinished = finished;
      } catch {
        // Server briefly unavailable: try again on the next tick.
      }
      if (!cancelled) timer = setTimeout(poll, running ? RUNNING_POLL_MS : IDLE_POLL_MS);
    };
    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [api.mode]);

  return { version, running: Boolean(ingest?.running), ingest };
}
