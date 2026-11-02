import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { describeEpssHistory, EpssSparkline } from '../src/components/EpssSparkline.tsx';

const date = '2026-10-30';

describe('EPSS history', () => {
  it('describes a rising score with its date range and a peak above both ends', () => {
    const text = describeEpssHistory({ score: 0.2, date, history: [['2026-10-01', 0.01], ['2026-10-10', 0.5], ['2026-10-20', 0.2]] });
    expect(text).toMatch(/^Rose from 1\.0% to 20\.0%, .*2026 – .*2026; peak 50\.0%$/);
  });

  it('describes flat, falling and round-trip histories', () => {
    expect(describeEpssHistory({ score: 0.0004, date, history: [['2026-10-01', 0.0004]] })).toMatch(/^Unchanged at 0\.04% from /);
    expect(describeEpssHistory({ score: 0.1, date, history: [['2026-10-01', 0.3], ['2026-10-05', 0.1]] })).toMatch(/^Fell from 30\.0% to 10\.0%/);
    expect(describeEpssHistory({ score: 0.1, date, history: [['2026-10-01', 0.1], ['2026-10-05', 0.4], ['2026-10-09', 0.1]] })).toMatch(/^Moved between 10\.0% and 40\.0%, back at 10\.0%/);
    expect(describeEpssHistory({ score: 0.1, date })).toBeNull();
  });

  it('draws one marker per change point and names the chart', () => {
    const { container } = render(<EpssSparkline epss={{ score: 0.00316, date, history: [['2026-10-24', 0.0012], ['2026-10-28', 0.00291], [date, 0.00316]] }} />);
    expect(screen.getByRole('img', { name: /^EPSS history: Rose from 0\.12% to 0\.32%/ })).toBeTruthy();
    expect(container.querySelectorAll('circle')).toHaveLength(3);
    expect(container.querySelector('svg')!.classList.contains('rising')).toBe(true);
  });
});
