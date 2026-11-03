import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { TrendsView } from '../src/components/TrendsView.tsx';
import { computeTrends, type TrendNode } from '../../shared/trends.ts';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const cve = (id: string, title: string, history: [string, number][], kev = false): TrendNode => ({
  id, type: 'vulnerability', title, attrs: { epss: { score: history.at(-1)![1], date: '2026-11-04', history }, ...(kev ? { kev: { dateAdded: '2024-01-01' } } : {}) },
});
const trends = computeTrends({
  nodes: [
    cve('cve:CVE-2026-1', 'Recent jump', [['2026-09-01', 0.01], ['2026-11-02', 0.31]], true),
    cve('cve:CVE-2026-2', 'Slow climb', [['2026-09-01', 0.05], ['2026-10-10', 0.55]]),
  ],
  weaknessesOf: new Map(),
  now: new Date('2026-11-04T12:00:00Z'),
  windowDays: 90,
});

describe('EPSS movers', () => {
  it('lists the largest rises per period, with KEV status, and opens a CVE', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify(trends), { status: 200, headers: { 'content-type': 'application/json' } }))));
    const onSelect = vi.fn();
    render(<TrendsView onSelect={onSelect} dataVersion="1" />);
    const card = (await screen.findByRole('heading', { name: /Largest rises in exploitation likelihood \(EPSS\), last 7 days/ })).closest('section')!;
    const rows = () => within(card).getAllByRole('row').slice(1);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]!.textContent).toMatch(/CVE-2026-1 KEVRecent jump1\.0% → 31\.0%.*\+30\.0 pp×31/);
    fireEvent.click(within(card).getByRole('button', { name: '30d' }));
    expect(within(card).getByRole('heading', { name: /last 30 days/ })).toBeTruthy();
    expect(rows().map((r) => within(r).getAllByRole('button')[0]!.textContent)).toEqual(['CVE-2026-2', 'CVE-2026-1']);
    fireEvent.click(within(card).getByRole('button', { name: 'CVE-2026-2' }));
    expect(onSelect).toHaveBeenCalledWith('cve:CVE-2026-2');
    expect(within(card).getByText(/stored history starts/).textContent).toMatch(/starts 1 Sep|starts Sep 1/);
  });
});
