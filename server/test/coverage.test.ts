import { describe, expect, it } from 'vitest';
import { coverageByCountry, edgeOther } from '../../shared/coverage.ts';

const article = (id: string, country: string | null, at: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: 'article',
  title: `Title ${id}`,
  occurredAt: at,
  category: 'security-news',
  country,
  geoBasis: country ? 'publisher_country' : null,
  attrs: { outlet: `Outlet ${id}` },
  ...extra,
});
const mention = (node: ReturnType<typeof article>, confidence = 0.95) => ({
  rel: 'mentions',
  direction: 'in' as const,
  basis: 'inferred' as const,
  confidence,
  rationale: 'Text contains the exact identifier CVE-1.',
  other: edgeOther(node, node.id),
});

describe('edgeOther', () => {
  it('adds publisher country, outlet and category for articles only', () => {
    expect(edgeOther(article('a', 'Japan', '2026-10-01T00:00:00Z', { category: 'advisory' }), 'a')).toEqual({
      id: 'a', type: 'article', title: 'Title a', occurredAt: '2026-10-01T00:00:00Z', category: 'advisory', publisherCountry: 'Japan', outlet: 'Outlet a',
    });
    expect(edgeOther({ id: 'q', type: 'natural_event', title: 'Quake', country: 'Chile', geoBasis: 'source_point' }, 'q')).toEqual({ id: 'q', type: 'natural_event', title: 'Quake', occurredAt: null });
    expect(edgeOther(undefined, 'gone')).toEqual({ id: 'gone', type: null, title: 'gone' });
  });

  it('never treats a country on another basis as a publisher country, and falls back to the domain', () => {
    const o = edgeOther({ ...article('b', 'France', '2026-10-01T00:00:00Z'), geoBasis: 'source_point', attrs: { domain: 'example.fr' } }, 'b');
    expect(o.publisherCountry).toBeNull();
    expect(o.outlet).toBe('example.fr');
  });
});

describe('coverageByCountry', () => {
  it('groups article mentions by publisher country, biggest first and unknown last, oldest item first', () => {
    const groups = coverageByCountry([
      mention(article('us2', 'United States', '2026-10-03T00:00:00Z')),
      mention(article('hn', null, '2026-10-01T00:00:00Z')),
      mention(article('jp', 'Japan', '2026-10-02T00:00:00Z', { category: 'advisory' })),
      mention(article('us1', 'United States', '2026-10-01T00:00:00Z')),
      mention(article('at', 'Austria', '2026-10-04T00:00:00Z'), 0.6),
      // Not coverage: an outgoing edge, and a non-article neighbour.
      { rel: 'affects', direction: 'out', basis: 'reported', confidence: 1, rationale: null, other: { id: 'product:x', type: 'product', title: 'X' } },
      { rel: 'mentions', direction: 'out', basis: 'inferred', confidence: 0.9, rationale: null, other: edgeOther(article('z', 'Germany', '2026-10-01T00:00:00Z'), 'z') },
    ]);
    expect(groups.map((g) => [g.country, g.items.map((i) => i.id)])).toEqual([
      ['United States', ['us1', 'us2']],
      ['Austria', ['at']],
      ['Japan', ['jp']],
      [null, ['hn']],
    ]);
    expect(groups[2]!.items[0]).toMatchObject({ advisory: true, outlet: 'Outlet jp', basis: 'inferred', confidence: 0.95 });
    expect(groups[1]!.items[0]!.confidence).toBe(0.6);
  });

  it('is empty without article mentions', () => {
    expect(coverageByCountry([])).toEqual([]);
  });
});
