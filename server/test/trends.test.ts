import { describe, expect, it } from 'vitest';
import { computeTrends, weekStart, WEEKS, type TrendNode } from '../../shared/trends.ts';

const NOW = new Date('2026-11-04T12:00:00Z'); // a Wednesday
const kev = (id: string, dateAdded: string, vendorProject: string, product: string, ransomware = 'Unknown'): TrendNode => ({
  id, type: 'vulnerability', occurredAt: `${dateAdded}T00:00:00.000Z`, ingestedAt: '2026-10-30T20:00:00.000Z', attrs: { kev: { dateAdded, vendorProject, product, ransomware } },
});

describe('trends', () => {
  it('aligns weeks to Monday UTC and covers 52 of them ending this week', () => {
    expect(weekStart(NOW).toISOString()).toBe('2026-11-02T00:00:00.000Z');
    expect(weekStart(new Date('2026-11-02T00:00:00Z')).toISOString()).toBe('2026-11-02T00:00:00.000Z');
    expect(weekStart(new Date('2026-11-08T23:59:59Z')).toISOString()).toBe('2026-11-02T00:00:00.000Z');
    const t = computeTrends({ nodes: [], weaknessesOf: new Map(), now: NOW, windowDays: 90 });
    expect(t.weeks).toHaveLength(WEEKS);
    expect(t.weeks.at(-1)).toBe('2026-11-02');
    expect(t.collectedSince).toBeNull();
  });

  it('counts KEV additions per week with the ransomware share, and ranks vendors, products and weaknesses in the window', () => {
    const nodes = [
      kev('cve:A', '2026-11-03', 'Ivanti', 'Connect Secure', 'Known'),
      kev('cve:B', '2026-11-02', 'Ivanti', 'Connect Secure'),
      kev('cve:C', '2026-10-28', 'Cisco', 'IOS XE'),
      kev('cve:D', '2026-06-01', 'Cisco', 'ASA'), // outside a 90-day window, inside the 52 weeks
      kev('cve:OLD', '2021-11-03', 'Microsoft', 'Windows'), // before the 52 weeks
      kev('cve:FUTURE', '2026-12-01', 'X', 'Y'), // never counted
      { id: 'cve:NVD', type: 'vulnerability', occurredAt: '2026-11-03T00:00:00.000Z', attrs: {} }, // not KEV
    ];
    const weaknessesOf = new Map([['cve:A', ['cwe:CWE-306']], ['cve:B', ['cwe:CWE-306', 'cwe:CWE-287']], ['cve:D', ['cwe:CWE-79']]]);
    const t = computeTrends({ nodes, weaknessesOf, now: NOW, windowDays: 90 });
    expect(t.kevWeekly.total.at(-1)).toBe(2);
    expect(t.kevWeekly.ransomware.at(-1)).toBe(1);
    expect(t.kevWeekly.total.at(-2)).toBe(1);
    expect(t.kevWeekly.total.reduce((a, b) => a + b, 0)).toBe(4);
    expect([t.kevInWindow, t.ransomwareInWindow]).toEqual([3, 1]);
    expect(t.topVendors).toEqual([{ id: 'vendor:ivanti', name: 'Ivanti', count: 2 }, { id: 'vendor:cisco', name: 'Cisco', count: 1 }]);
    expect(t.topProducts[0]).toEqual({ id: 'product:ivanti/connect-secure', name: 'Ivanti Connect Secure', count: 2 });
    expect(t.topWeaknesses).toEqual([{ id: 'cwe:CWE-306', name: 'CWE-306', count: 2 }, { id: 'cwe:CWE-287', name: 'CWE-287', count: 1 }]);
    expect(computeTrends({ nodes, weaknessesOf, now: NOW, windowDays: 365 }).topVendors[0]).toEqual({ id: 'vendor:cisco', name: 'Cisco', count: 2 });
  });

  it('reports collection activity separately, with when collection started', () => {
    const nodes: TrendNode[] = [
      { id: 'news:1', type: 'article', occurredAt: '2026-11-03T08:00:00.000Z', ingestedAt: '2026-11-03T09:00:00.000Z' },
      { id: 'news:2', type: 'article', occurredAt: '2026-10-29T08:00:00.000Z', ingestedAt: '2026-10-31T09:00:00.000Z' },
      { id: 'quake:1', type: 'natural_event', occurredAt: '2026-11-04T01:00:00.000Z', ingestedAt: '2026-11-04T02:00:00.000Z' },
    ];
    const t = computeTrends({ nodes, weaknessesOf: new Map(), now: NOW, windowDays: 30 });
    expect(t.collectedSince).toBe('2026-10-31T09:00:00.000Z');
    expect(t.collectedWeekly.article.slice(-2)).toEqual([1, 1]);
    expect(t.collectedWeekly.natural_event.at(-1)).toBe(1);
  });
});
