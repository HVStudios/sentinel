import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { loadWatchlist, STORAGE_KEY, useWatchlist, type WatchStatus } from '../src/lib/watchlist.ts';
import { WatchlistView } from '../src/components/WatchlistView.tsx';
import { article, kevCve } from './fixtures.ts';

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('watchlist storage', () => {
  it('adds, marks seen, removes, and persists to localStorage', () => {
    let t = new Date('2026-10-30T10:00:00Z');
    const { result } = renderHook(() => useWatchlist(() => t));
    act(() => result.current.toggle({ id: 'vendor:ivanti', type: 'vendor', title: 'Ivanti' }));
    expect(result.current.isWatched('vendor:ivanti')).toBe(true);
    expect(loadWatchlist()).toEqual([{ id: 'vendor:ivanti', type: 'vendor', title: 'Ivanti', addedAt: t.toISOString(), lastSeenAt: t.toISOString() }]);
    t = new Date('2026-10-31T10:00:00Z');
    act(() => result.current.markSeen('vendor:ivanti'));
    expect(loadWatchlist()[0]!.lastSeenAt).toBe('2026-10-31T10:00:00.000Z');
    act(() => result.current.toggle({ id: 'vendor:ivanti', type: 'vendor', title: 'Ivanti' }));
    expect(loadWatchlist()).toEqual([]);
  });

  it('ignores corrupt or unavailable storage', () => {
    localStorage.setItem(STORAGE_KEY, '{not json');
    expect(loadWatchlist()).toEqual([]);
    localStorage.setItem(STORAGE_KEY, JSON.stringify([{ id: 'x' }, { id: 'vendor:a', type: 'vendor', title: 'A', addedAt: 'x', lastSeenAt: 'x' }]));
    expect(loadWatchlist().map((w) => w.id)).toEqual(['vendor:a']);
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(loadWatchlist()).toEqual([]);
    spy.mockRestore();
  });
});

describe('WatchlistView', () => {
  const status = (lastSeenAt: string): WatchStatus => {
    const watch = { id: 'vendor:ivanti', type: 'vendor' as const, title: 'Ivanti', addedAt: 'x', lastSeenAt };
    const items = [{ ...kevCve, ingestedAt: '2026-10-30T12:00:00.000Z', via: 'affects Ivanti Connect Secure' }, { ...article, ingestedAt: '2026-10-28T12:00:00.000Z', via: 'mentions Ivanti' }];
    const isNew = (i: { ingestedAt: string }) => i.ingestedAt > lastSeenAt;
    return { watch, items, isNew, newCount: items.filter(isNew).length };
  };

  it('marks items first seen after the last check as new, with the reason they relate', () => {
    const onMarkSeen = vi.fn();
    const onRemove = vi.fn();
    render(<WatchlistView statuses={[status('2026-10-29T00:00:00.000Z')]} totalNew={1} onSelect={() => {}} onMarkSeen={onMarkSeen} onRemove={onRemove} />);
    expect(screen.getByText('1 new')).toBeTruthy();
    expect(screen.getAllByText('New')).toHaveLength(1);
    expect(screen.getByText(/affects Ivanti Connect Secure/)).toBeTruthy();
    fireEvent.click(screen.getByText('Mark as seen'));
    expect(onMarkSeen).toHaveBeenCalledWith('vendor:ivanti');
    fireEvent.click(screen.getByText('Mark all as seen'));
    expect(onMarkSeen).toHaveBeenLastCalledWith();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Ivanti from watchlist' }));
    expect(onRemove).toHaveBeenCalledWith('vendor:ivanti');
  });

  it('explains how to watch when empty', () => {
    render(<WatchlistView statuses={[]} totalNew={0} onSelect={() => {}} onMarkSeen={() => {}} onRemove={() => {}} />);
    expect(screen.getByText('Nothing watched yet.')).toBeTruthy();
    expect(screen.getByText(/stored only in this browser/)).toBeTruthy();
  });
});
