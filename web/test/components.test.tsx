import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Feed } from '../src/components/Feed.tsx';
import { WorldMap } from '../src/components/WorldMap.tsx';
import { Investigate } from '../src/components/Investigate.tsx';
import { Timeline } from '../src/components/Timeline.tsx';
import { article, detail, kevCve, quake } from './fixtures.ts';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));

describe('Feed', () => {
  it('renders items with badges, attribution and publisher-country caveat', () => {
    const onSelect = vi.fn();
    render(<Feed items={[kevCve, quake, article]} loading={false} hasMore selectedId={null} onSelect={onSelect} onMore={() => {}} />);
    expect(screen.getByText('Ivanti Connect Secure Missing Authentication')).toBeTruthy();
    expect(screen.getByText('KEV')).toBeTruthy();
    expect(screen.getByText('M6.4')).toBeTruthy();
    expect(screen.getByText('publisher: Germany').getAttribute('title')).toMatch(/not of the event/);
    expect(screen.getByText('Load more')).toBeTruthy();
    fireEvent.click(screen.getByText('Ivanti flaw exploited'));
    expect(onSelect).toHaveBeenCalledWith('news:abc');
  });

  it('explains an empty window', () => {
    render(<Feed items={[]} loading={false} hasMore={false} selectedId={null} onSelect={() => {}} onMore={() => {}} />);
    expect(screen.getByText(/Nothing in this window/)).toBeTruthy();
  });
});

describe('WorldMap', () => {
  it('plots points at source coordinates and shades publisher countries', () => {
    const onSelect = vi.fn();
    const { container } = render(
      <WorldMap
        points={[quake]}
        countryCounts={[{ country: 'Germany', count: 3 }, { country: 'Singapore', count: 2 }]}
        selectedId={null}
        onSelect={onSelect}
        showCountries
      />,
    );
    const point = container.querySelector('[data-id="quake:us7000ttxz"]')!;
    expect(point).toBeTruthy();
    fireEvent.click(point);
    expect(onSelect).toHaveBeenCalledWith('quake:us7000ttxz');
    expect((container.querySelector('[data-country="Germany"]') as SVGPathElement).style.fill).toContain('color-mix');
    expect((container.querySelector('[data-country="France"]') as SVGPathElement).style.fill).toBe('');
    expect(screen.getByText(/Not drawn: Singapore \(2\)/)).toBeTruthy();
    expect(screen.getByText(/Vulnerabilities are not mapped/)).toBeTruthy();
  });

  it('hides shading when disabled', () => {
    const { container } = render(<WorldMap points={[]} countryCounts={[{ country: 'Germany', count: 3 }]} selectedId={null} onSelect={() => {}} showCountries={false} />);
    expect((container.querySelector('[data-country="Germany"]') as SVGPathElement).style.fill).toBe('');
  });
});

describe('Timeline', () => {
  it('renders stacked bars and reports a brushed range', () => {
    const onBrush = vi.fn();
    const { container } = render(
      <Timeline
        from="2026-10-01T00:00:00.000Z"
        to="2026-10-31T00:00:00.000Z"
        bucketMs={86_400_000 * 10}
        series={{ vulnerability: [1, 0, 2], article: [0, 3, 0] }}
        selection={null}
        onBrush={onBrush}
      />,
    );
    expect(container.querySelectorAll('rect.bar')).toHaveLength(3);
    const svg = container.querySelector('svg')!;
    svg.getBoundingClientRect = () => ({ left: 0, width: 960, top: 0, height: 84, right: 960, bottom: 84, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.pointerDown(svg, { clientX: 0, pointerId: 1 });
    fireEvent.pointerMove(svg, { clientX: 480, pointerId: 1 });
    fireEvent.pointerUp(svg, { clientX: 480, pointerId: 1 });
    expect(onBrush).toHaveBeenCalledWith({ from: '2026-10-01T00:00:00.000Z', to: '2026-10-16T00:00:00.000Z' });
    fireEvent.pointerDown(svg, { clientX: 100, pointerId: 1 });
    fireEvent.pointerUp(svg, { clientX: 100, pointerId: 1 });
    expect(onBrush).toHaveBeenLastCalledWith(null);
  });
});

describe('Investigate', () => {
  it('shows facts, provenance, and distinguishes reported from inferred relationships', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) =>
      url.startsWith('/api/nodes/') ? json(detail) : json({ nodes: [kevCve, article], edges: [detail.edges[1]] }),
    ));
    const onSelect = vi.fn();
    render(<Investigate id={kevCve.id} onSelect={onSelect} onClose={() => {}} />);
    await screen.findByRole('heading', { name: 'Ivanti Connect Secure Missing Authentication' });
    expect(screen.getByText('No location reported by source')).toBeTruthy();
    expect(screen.getByText('2026-11-02')).toBeTruthy();
    expect(screen.getByText('reported · cisa-kev')).toBeTruthy();
    expect(screen.getByText('inferred · 95%')).toBeTruthy();
    expect(screen.getByText('Text contains the exact identifier CVE-2026-111357.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'CISA KEV' })).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('img', { name: 'Relationship graph' })).toBeTruthy());

    const rel = screen.getByText('Mentioned by').closest('.rel-group') as HTMLElement;
    fireEvent.click(within(rel).getByText('Ivanti flaw exploited'));
    expect(onSelect).toHaveBeenCalledWith('news:abc');
  });

  it('reports load errors', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('nope', { status: 404, statusText: 'Not Found' }))));
    render(<Investigate id="cve:missing" onSelect={() => {}} onClose={() => {}} />);
    expect(await screen.findByText(/Could not load cve:missing/)).toBeTruthy();
  });
});
