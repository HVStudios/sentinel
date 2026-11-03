import { describe, expect, it } from 'vitest';
import { BEST_EFFORT_RUNS, sourceAlert, sourceAlerts, type HealthRun } from '../../shared/health.ts';

let t = Date.parse('2026-10-01T00:00:00Z');
const ok = (count: number): HealthRun => ({ at: new Date((t += 21_600_000)).toISOString(), status: 'ok', count });
const err = (): HealthRun => ({ at: new Date((t += 21_600_000)).toISOString(), status: 'error', count: 0 });

describe('source health alerts', () => {
  it('flags three failed runs in a row, and counts the whole streak', () => {
    expect(sourceAlert({ id: 'nvd', runs: [ok(100), err(), err()] })).toBeNull();
    expect(sourceAlert({ id: 'nvd', runs: [ok(100), err(), err(), err(), err()] })).toEqual({ sourceId: 'nvd', kind: 'failing', reason: 'The last 4 runs failed' });
    expect(sourceAlert({ id: 'nvd', runs: [err(), err(), err(), ok(100)] })).toBeNull();
  });

  it('flags a count far below the recent median of successful runs', () => {
    const runs = [ok(300), ok(310), err(), ok(290), ok(305), ok(295)];
    expect(sourceAlert({ id: 'news-feeds', runs: [...runs, ok(200)] })).toBeNull();
    expect(sourceAlert({ id: 'news-feeds', runs: [...runs, ok(120)] })).toEqual({
      sourceId: 'news-feeds',
      kind: 'drop',
      reason: 'Last run returned 120 records, against a recent median of 300',
    });
  });

  it('needs enough history and a meaningful baseline before judging a drop', () => {
    expect(sourceAlert({ id: 'gdacs', runs: [ok(30), ok(30), ok(30), ok(30), ok(2)] })).toBeNull();
    // Incremental lookups (e.g. Wikidata) normally return very few records.
    expect(sourceAlert({ id: 'wikidata-vendors', runs: [ok(4), ok(1), ok(0), ok(3), ok(2), ok(0)] })).toBeNull();
    expect(sourceAlert({ id: 'x', runs: [] })).toBeNull();
    expect(sourceAlert({ id: 'x' })).toBeNull();
  });

  it('judges best-effort GDELT only on a long run without any records', () => {
    const flaky = [ok(0), err(), err(), ok(75), err(), err(), err(), err()];
    expect(sourceAlert({ id: 'gdelt', runs: flaky })).toBeNull();
    const silent = Array.from({ length: BEST_EFFORT_RUNS }, (_, i) => (i % 2 ? err() : ok(0)));
    expect(sourceAlert({ id: 'gdelt', runs: silent })?.kind).toBe('failing');
    // One good run clears it again: the alarm is never permanent.
    expect(sourceAlert({ id: 'gdelt', runs: [...silent, ok(40)] })).toBeNull();
    // Drops are not judged for best-effort sources.
    expect(sourceAlert({ id: 'gdelt', runs: [ok(80), ok(80), ok(80), ok(80), ok(80), ok(3)] })).toBeNull();
  });

  it('lists only flagged sources', () => {
    expect(sourceAlerts([{ id: 'a', runs: [err(), err(), err()] }, { id: 'b', runs: [ok(5)] }]).map((a) => a.sourceId)).toEqual(['a']);
  });
});
