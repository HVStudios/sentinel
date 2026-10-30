import { useEffect, useState } from 'react';

export interface FetchState<T> {
  data: T | undefined;
  error: Error | undefined;
  loading: boolean;
}

/** Runs `fn` whenever `key` changes, aborting the previous request. */
export function useFetch<T>(fn: (signal: AbortSignal) => Promise<T>, key: string | null): FetchState<T> {
  const [state, setState] = useState<FetchState<T>>({ data: undefined, error: undefined, loading: key !== null });
  useEffect(() => {
    if (key === null) return;
    const ctrl = new AbortController();
    setState((s) => ({ ...s, loading: true, error: undefined }));
    fn(ctrl.signal).then(
      (data) => setState({ data, error: undefined, loading: false }),
      (error: Error) => {
        if (!ctrl.signal.aborted) setState((s) => ({ ...s, error, loading: false }));
      },
    );
    return () => ctrl.abort();
    // `fn` is intentionally excluded: callers encode every input in `key`.
  }, [key]);
  return state;
}
