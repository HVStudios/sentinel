import { describe, expect, it } from 'vitest';
import { DEFAULT_VIEW, formatHash, isNavigation, parseHash, type ViewState } from '../src/lib/urlState.ts';

describe('URL view state', () => {
  it('keeps default links short and old deep links working', () => {
    expect(formatHash(DEFAULT_VIEW)).toBe('#/');
    expect(formatHash({ ...DEFAULT_VIEW, node: 'cve:CVE-2026-111357' })).toBe('#/node/cve%3ACVE-2026-111357');
    expect(parseHash('#/node/cve%3ACVE-2026-111357')).toEqual({ ...DEFAULT_VIEW, node: 'cve:CVE-2026-111357' });
    expect(parseHash('')).toEqual(DEFAULT_VIEW);
  });

  it('round-trips every part of the view', () => {
    const view: ViewState = {
      node: 'vendor:ivanti',
      preset: '30d',
      brush: { from: '2026-10-20T00:00:00.000Z', to: '2026-10-25T00:00:00.000Z' },
      types: ['vulnerability', 'article'],
      q: 'connect secure & more',
      sort: 'top',
      view: 'stories',
      main: 'trends',
      hidden: ['publishers', 'gdacs'],
    };
    const hash = formatHash(view);
    expect(hash).toContain('t=vulnerability,article');
    expect(hash).toContain('off=publishers,gdacs');
    expect(parseHash(hash)).toEqual(view);
  });

  it('falls back to defaults for anything malformed, so a shared link never breaks the page', () => {
    expect(parseHash('#/?w=5y&t=bogus&sort=weird&view=x&main=y&off=nope&from=yesterday&to=2026-01-01')).toEqual(DEFAULT_VIEW);
    expect(parseHash('#/node/%E0%A4%A')).toEqual(DEFAULT_VIEW); // bad encoding
    expect(parseHash('#/?from=2026-10-25T00:00:00Z&to=2026-10-20T00:00:00Z').brush).toBeNull(); // reversed range
    expect(parseHash(`#/?q=${'x'.repeat(500)}`).q).toHaveLength(200);
  });

  it('treats filter changes as navigation, but not typing a search', () => {
    expect(isNavigation(DEFAULT_VIEW, { ...DEFAULT_VIEW, preset: '30d' })).toBe(true);
    expect(isNavigation(DEFAULT_VIEW, { ...DEFAULT_VIEW, node: 'x' })).toBe(true);
    expect(isNavigation(DEFAULT_VIEW, { ...DEFAULT_VIEW, q: 'ivanti' })).toBe(false);
  });
});
