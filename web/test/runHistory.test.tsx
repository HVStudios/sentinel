import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { SourceRun } from '../src/api.ts';
import { describeRuns, formatDuration, RunHistory, summarizeRuns } from '../src/components/RunHistory.tsx';

const run = (status: SourceRun['status'], count: number, durationMs: number, error?: string): SourceRun => ({ at: '2026-10-30T00:00:00Z', status, count, durationMs, ...(error ? { error } : {}) });
const runs = [run('ok', 10, 900), run('ok', 12, 1500, '1 of 17 feeds failed'), run('error', 0, 300, 'HTTP 429'), run('ok', 11, 2100)];

describe('source run history', () => {
  it('counts outcomes, treating warnings separately, and takes the median duration', () => {
    expect(summarizeRuns(runs)).toEqual({ total: 4, ok: 2, warn: 1, error: 1, medianMs: 1200 });
    expect(describeRuns(runs)).toBe('4 runs: 2 ok, 1 with warnings, 1 failed · median 1.2 s');
    expect(describeRuns([run('ok', 1, 40)])).toBe('1 run: 1 ok · median 40 ms');
    expect(formatDuration(125_000)).toBe('2.1 min');
  });

  it('draws one bar per run coloured by outcome, failed runs full height', () => {
    const { container } = render(<RunHistory runs={runs} />);
    const bars = [...container.querySelectorAll('rect')];
    expect(bars.map((b) => b.getAttribute('class'))).toEqual(['run-ok', 'run-warn', 'run-error', 'run-ok']);
    expect(bars[2]!.getAttribute('height')).toBe('22');
    expect(Number(bars[0]!.getAttribute('height'))).toBeLessThan(Number(bars[1]!.getAttribute('height')));
    expect(screen.getByText(/^4 runs:/)).toBeTruthy();
  });

  it('shows a dash before the first run', () => {
    render(<RunHistory runs={[]} />);
    expect(screen.getByText('—')).toBeTruthy();
  });
});
