import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { IDLE_POLL_MS, RUNNING_POLL_MS, useDataVersion } from '../src/lib/useDataVersion.ts';
import type { SourcesResponse } from '../src/api.ts';

afterEach(() => vi.useRealTimers());

const status = (running: boolean, finishedAt?: string): SourcesResponse => ({
  sources: [],
  ingest: { running, last: { startedAt: '2026-10-31T10:00:00.000Z', finishedAt }, refreshMinutes: 60, nextRunAt: null },
});

describe('useDataVersion', () => {
  it('bumps the version only when a refresh finishes, polling faster while one runs', async () => {
    vi.useFakeTimers();
    const sources = vi
      .fn()
      .mockResolvedValueOnce(status(false, '2026-10-31T09:00:00.000Z')) // initial state: no reload
      .mockResolvedValueOnce(status(true, undefined)) // a scheduled refresh started
      .mockResolvedValueOnce(status(false, '2026-10-31T10:05:00.000Z')) // ...and finished
      .mockResolvedValue(status(false, '2026-10-31T10:05:00.000Z'));
    const api = { mode: 'live' as const, sources };
    const { result, unmount } = renderHook(() => useDataVersion(api));
    await act(async () => {});
    expect(result.current.version).toBe('');

    await act(async () => { await vi.advanceTimersByTimeAsync(IDLE_POLL_MS); });
    expect(result.current.running).toBe(true);
    expect(result.current.version).toBe('');

    await act(async () => { await vi.advanceTimersByTimeAsync(RUNNING_POLL_MS); });
    expect(result.current.running).toBe(false);
    expect(result.current.version).toBe('2026-10-31T10:05:00.000Z');

    await act(async () => { await vi.advanceTimersByTimeAsync(IDLE_POLL_MS); });
    expect(result.current.version).toBe('2026-10-31T10:05:00.000Z'); // unchanged: no spurious reloads
    expect(sources).toHaveBeenCalledTimes(4);
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(IDLE_POLL_MS * 5); });
    expect(sources).toHaveBeenCalledTimes(4); // polling stops when unmounted
  });

  it('never polls the static snapshot build', async () => {
    const sources = vi.fn();
    renderHook(() => useDataVersion({ mode: 'static', sources }));
    await act(async () => {});
    expect(sources).not.toHaveBeenCalled();
  });

  it('keeps polling after a failed request', async () => {
    vi.useFakeTimers();
    const sources = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue(status(false, 'x'));
    renderHook(() => useDataVersion({ mode: 'live', sources }));
    await act(async () => { await vi.advanceTimersByTimeAsync(IDLE_POLL_MS); });
    expect(sources).toHaveBeenCalledTimes(2);
  });
});
