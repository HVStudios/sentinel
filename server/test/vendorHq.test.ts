import { describe, expect, it } from 'vitest';
import { vendorHqsFor, type HqLookup } from '../../shared/vendorHq.ts';

const wd = (confidence: number, extra: Record<string, unknown> = {}) => ({
  wikidata: { status: 'matched', confidence, hq: { label: 'Springfield', country: 'United States', lat: 40, lon: -90 }, ...extra },
});

const nodes = [
  { id: 'cve:1', type: 'vulnerability', title: 'CVE-1' },
  { id: 'product:a/x', type: 'product', title: 'A X' },
  { id: 'product:a/y', type: 'product', title: 'A Y' },
  { id: 'product:b/z', type: 'product', title: 'B Z' },
  { id: 'product:c/w', type: 'product', title: 'C W' },
  { id: 'vendor:a', type: 'vendor', title: 'A', attrs: wd(0.95) },
  { id: 'vendor:b', type: 'vendor', title: 'B', attrs: wd(0.6) },
  { id: 'vendor:c', type: 'vendor', title: 'C', attrs: { wikidata: { status: 'ambiguous', candidates: [] } } },
];
const edges = [
  { src: 'cve:1', dst: 'product:a/x', rel: 'affects' },
  { src: 'cve:1', dst: 'product:a/y', rel: 'affects' },
  { src: 'cve:1', dst: 'product:b/z', rel: 'affects' },
  { src: 'cve:1', dst: 'product:c/w', rel: 'affects' },
  { src: 'product:a/x', dst: 'vendor:a', rel: 'made_by' },
  { src: 'product:a/y', dst: 'vendor:a', rel: 'made_by' },
  { src: 'product:b/z', dst: 'vendor:b', rel: 'made_by' },
  { src: 'product:c/w', dst: 'vendor:c', rel: 'made_by' },
];
const lookup: HqLookup = {
  node: (id) => nodes.find((n) => n.id === id),
  edges: (id) => edges.filter((e) => e.src === id || e.dst === id),
};

describe('vendorHqsFor', () => {
  it('follows affects → made_by and keeps only confident Wikidata matches', () => {
    expect(vendorHqsFor(lookup, 'cve:1')).toEqual([
      { id: 'vendor:a', title: 'A', lat: 40, lon: -90, hq: 'Springfield', country: 'United States', via: ['A X', 'A Y'] },
    ]);
  });

  it('resolves products and vendors directly', () => {
    expect(vendorHqsFor(lookup, 'product:a/x').map((v) => v.id)).toEqual(['vendor:a']);
    expect(vendorHqsFor(lookup, 'vendor:a').map((v) => v.via)).toEqual([[]]);
    expect(vendorHqsFor(lookup, 'vendor:b')).toEqual([]);
    expect(vendorHqsFor(lookup, 'missing')).toEqual([]);
  });
});
