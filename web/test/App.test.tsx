import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from '../src/App.tsx';
import { article, detail, kevCve, quake } from './fixtures.ts';

const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));

function mockApi() {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      calls.push(decodeURIComponent(url));
      const path = url.split('?')[0];
      if (path === '/api/feed') return json({ items: [article, kevCve, quake], nextCursor: null });
      if (path === '/api/map') return json({ points: [quake], countries: [{ country: 'Germany', count: 1 }] });
      if (path === '/api/timeline') return json({ from: '2026-10-23T00:00:00.000Z', to: '2026-10-30T00:00:00.000Z', bucketMs: 3_600_000, series: { article: [1] } });
      if (path?.startsWith('/api/nodes/')) return json(detail);
      if (path?.startsWith('/api/graph/')) return json({ nodes: [kevCve], edges: [] });
      return Promise.resolve(new Response('{}', { status: 404 }));
    }),
  );
  return calls;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = '';
});

describe('App', () => {
  it('loads map, feed and timeline, and opens an investigation from the feed', async () => {
    const calls = mockApi();
    render(<App now={() => new Date('2026-10-30T12:00:00Z')} />);
    expect(screen.getByText('SENTINEL')).toBeTruthy();
    await screen.findByText('Ivanti Connect Secure Missing Authentication');
    expect(calls.some((c) => c.startsWith('/api/map?from=2026-10-23T12:00:00.000Z'))).toBe(true);
    expect(screen.getByText(/1 mapped events/)).toBeTruthy();

    fireEvent.click(screen.getByText('Ivanti Connect Secure Missing Authentication'));
    await screen.findByRole('complementary', { name: 'Investigation' });
    expect(window.location.hash).toBe('#/node/cve%3ACVE-2026-111357');
    fireEvent.click(screen.getByLabelText('Close investigation'));
    expect(screen.queryByRole('complementary', { name: 'Investigation' })).toBeNull();
  });

  it('refetches with category, window and search filters', async () => {
    const calls = mockApi();
    render(<App now={() => new Date('2026-10-30T12:00:00Z')} />);
    await screen.findByText('Ivanti flaw exploited');

    fireEvent.click(screen.getByRole('button', { name: /News & tech/ }));
    await waitFor(() => expect(calls.some((c) => c.includes('types=vulnerability,natural_event'))).toBe(true));

    fireEvent.click(screen.getByRole('button', { name: '30d' }));
    await waitFor(() => expect(calls.some((c) => c.includes('from=2026-09-30T12:00:00.000Z'))).toBe(true));

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'ivanti' } });
    await waitFor(() => expect(calls.some((c) => c.startsWith('/api/feed') && c.includes('q=ivanti'))).toBe(true));
  });

  it('orders the feed as mixed by default and switches without refetching the map', async () => {
    const calls = mockApi();
    render(<App now={() => new Date('2026-10-30T12:00:00Z')} />);
    await screen.findByText('Ivanti flaw exploited');
    expect(calls.some((c) => c.startsWith('/api/feed') && c.includes('sort=mixed'))).toBe(true);
    const mapCalls = calls.filter((c) => c.startsWith('/api/map')).length;
    fireEvent.click(screen.getByRole('button', { name: 'Top' }));
    await waitFor(() => expect(calls.some((c) => c.startsWith('/api/feed') && c.includes('sort=top'))).toBe(true));
    expect(calls.filter((c) => c.startsWith('/api/map')).length).toBe(mapCalls);
    expect(screen.getByRole('button', { name: 'Top' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('never allows deselecting every category', async () => {
    mockApi();
    render(<App now={() => new Date('2026-10-30T12:00:00Z')} />);
    for (const name of [/Vulnerability/, /World event/, /News & tech/]) fireEvent.click(screen.getByRole('button', { name }));
    expect(screen.getByRole('button', { name: /News & tech/ }).getAttribute('aria-pressed')).toBe('true');
  });
});
