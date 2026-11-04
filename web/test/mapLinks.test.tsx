import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { clusterPoints } from '../src/lib/clusters.ts';
import { WorldMap } from '../src/components/WorldMap.tsx';
import { Timeline, playbackStep } from '../src/components/Timeline.tsx';
import { quake } from './fixtures.ts';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const pt = (id: string, x: number, y: number, weight = 0) => ({ id, x, y, weight, item: id });

describe('clusterPoints', () => {
  it('merges points closer than the radius, seeded by the heaviest point', () => {
    const { singles, clusters } = clusterPoints([pt('a', 0, 0, 0.1), pt('b', 5, 0, 0.9), pt('c', 9, 0, 0.2), pt('far', 100, 100)], 8);
    expect(singles.map((s) => s.id)).toEqual(['far']);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.id).toBe('cluster:b');
    expect(clusters[0]!.members.map((m) => m.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('splits when the radius shrinks (zooming in) and keeps the open item apart', () => {
    const pts = [pt('a', 0, 0), pt('b', 5, 0)];
    expect(clusterPoints(pts, 4).clusters).toHaveLength(0);
    expect(clusterPoints(pts, 8, (id) => id === 'a').clusters).toHaveLength(0);
    expect(clusterPoints(pts, 0).singles).toHaveLength(2);
  });
});

describe('WorldMap clusters and selection links', () => {
  const near = (id: string, dLon: number) => ({ ...quake, id, lon: (quake.lon ?? 0) + dLon });

  it('draws nearby events as one labelled, keyboard-reachable cluster', () => {
    render(<WorldMap points={[near('quake:a', 0), near('quake:b', 0.2), near('quake:c', 0.4)]} countryCounts={[]} selectedId={null} onSelect={() => {}} showCountries={false} />);
    const cluster = screen.getByRole('button', { name: /^3 events near .+ \(Earthquake: 3\)/ });
    expect(cluster.getAttribute('data-count')).toBe('3');
    expect(cluster.getAttribute('tabindex')).toBe('0');
    expect(document.querySelectorAll('g.point')).toHaveLength(0);
  });

  it('keeps the selected event out of a cluster', () => {
    render(<WorldMap points={[near('quake:a', 0), near('quake:b', 0.2)]} countryCounts={[]} selectedId="quake:a" onSelect={() => {}} showCountries={false} />);
    expect(document.querySelector('g.point[data-id="quake:a"]')).toBeTruthy();
    expect(document.querySelector('g.cluster')).toBeNull();
  });

  it('describes selection links in the Layers card and offers a switch', () => {
    const onLayer = vi.fn();
    render(
      <WorldMap
        points={[]}
        countryCounts={[]}
        selectedId="cve:1"
        onSelect={() => {}}
        showCountries={false}
        layers={{ countries: true, vendors: true, affected: true, links: true }}
        onLayer={onLayer}
        showLinks
        links={{
          id: 'cve:1',
          title: 'CVE-1',
          origin: null,
          vendors: [{ id: 'vendor:ivanti', title: 'Ivanti', lat: 40.56, lon: -111.96, hq: 'South Jordan', country: 'United States', via: ['Connect Secure'] }],
          countries: [{ country: 'Canada', count: 1, confidence: 0.8 }, { country: 'Singapore', count: 1, confidence: 0.6 }],
        }}
      />,
    );
    const note = screen.getByTestId('links-note');
    expect(note.textContent).toMatch(/headquarters of Ivanti \(South Jordan, United States\)/);
    expect(note.textContent).toMatch(/publisher countries .*\(Canada, Singapore\)/);
    expect(note.textContent).toMatch(/Not drawn: Singapore/);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Selection links' }));
    expect(onLayer).toHaveBeenCalledWith('links', false);
  });
});

describe('Timeline playback', () => {
  const day = 86_400_000;
  it('steps a window forward a quarter of its width and stops at the end', () => {
    expect(playbackStep(0, 32 * day, day, null, false)).toEqual({ from: 0, to: 4 * day, done: false });
    expect(playbackStep(0, 32 * day, day, { from: 0, to: 4 * day }, false)).toEqual({ from: day, to: 5 * day, done: false });
    expect(playbackStep(0, 32 * day, day, { from: 27 * day, to: 31 * day }, false)).toEqual({ from: 28 * day, to: 32 * day, done: true });
    expect(playbackStep(0, 32 * day, day, { from: 28 * day, to: 32 * day }, true)).toEqual({ from: 0, to: 4 * day, done: false });
  });

  it('plays and pauses from buttons, moving the brush in order', () => {
    vi.useFakeTimers();
    const onBrush = vi.fn();
    const onPlaying = vi.fn();
    const props = { from: new Date(0).toISOString(), to: new Date(32 * day).toISOString(), bucketMs: day, series: {}, onBrush, onPlayingChange: onPlaying };
    const { rerender } = render(<Timeline {...props} selection={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(onBrush).toHaveBeenLastCalledWith({ from: new Date(0).toISOString(), to: new Date(4 * day).toISOString() });
    expect(onPlaying).toHaveBeenLastCalledWith(true);
    rerender(<Timeline {...props} selection={{ from: new Date(0).toISOString(), to: new Date(4 * day).toISOString() }} />);
    act(() => void vi.advanceTimersByTime(2500));
    expect(onBrush).toHaveBeenLastCalledWith({ from: new Date(day).toISOString(), to: new Date(5 * day).toISOString() });
    fireEvent.click(screen.getByRole('button', { name: 'Pause playback' }));
    expect(onPlaying).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole('status').textContent).toBe('Playback paused');
  });
});
