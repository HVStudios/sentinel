import { describe, expect, it } from 'vitest';
import { compactKey, mergeDuplicateVendors, planVendorMerges, strippedKeys, type VendorInfo } from '../src/dedupe.ts';
import { Store } from '../src/store.ts';

const v = (id: string, title: string, kev = false, products = 1): VendorInfo => ({ id, title, kev, products });

describe('vendor name keys', () => {
  it('compacts names and strips trailing suffix words', () => {
    expect(compactKey('Palo Alto Networks')).toBe('paloaltonetworks');
    expect(compactKey('D-Link')).toBe(compactKey('Dlink'));
    expect(strippedKeys('Zohocorp')).toContain('zoho');
    expect(strippedKeys('Sudo Project')).toContain('sudo');
    expect(strippedKeys('Barracuda Networks')).toContain('barracuda');
    expect(strippedKeys('Dahuasecurity')).toContain('dahua');
    // Never strips down to a fragment.
    expect(strippedKeys('Zinc')).toEqual([]);
    expect(strippedKeys('Labs')).toEqual([]);
  });
});

describe('merge planning', () => {
  it('merges run-together NVD names into readable KEV names', () => {
    const plans = planVendorMerges([v('vendor:palo-alto-networks', 'Palo Alto Networks', true), v('vendor:paloaltonetworks', 'Paloaltonetworks'), v('vendor:d-link', 'D-Link', true), v('vendor:dlink', 'Dlink')]);
    expect(plans).toEqual([
      { from: 'vendor:paloaltonetworks', into: 'vendor:palo-alto-networks', rule: 'exact' },
      { from: 'vendor:dlink', into: 'vendor:d-link', rule: 'exact' },
    ]);
  });

  it('keeps the KEV spelling even when the other one looks more readable', () => {
    expect(planVendorMerges([v('vendor:simple-help', 'Simple-Help'), v('vendor:simplehelp', 'SimpleHelp', true)])).toEqual([
      { from: 'vendor:simple-help', into: 'vendor:simplehelp', rule: 'exact' },
    ]);
  });

  it('merges suffix variants into a single KEV vendor only', () => {
    const plans = planVendorMerges([
      v('vendor:zoho', 'Zoho', true), v('vendor:zohocorp', 'Zohocorp'),
      v('vendor:grafana-labs', 'Grafana Labs', true), v('vendor:grafana', 'Grafana'),
      v('vendor:versa', 'Versa', true), v('vendor:versa-networks', 'Versa-Networks'),
    ]);
    expect(plans).toEqual([
      { from: 'vendor:zohocorp', into: 'vendor:zoho', rule: 'suffix' },
      { from: 'vendor:grafana', into: 'vendor:grafana-labs', rule: 'suffix' },
      { from: 'vendor:versa-networks', into: 'vendor:versa', rule: 'suffix' },
    ]);
  });

  it('never merges on prefixes, short names, or without a KEV anchor', () => {
    expect(planVendorMerges([v('vendor:intel', 'Intel', true), v('vendor:intellian', 'Intellian')])).toEqual([]);
    expect(planVendorMerges([v('vendor:hitachi-vantara', 'Hitachi Vantara', true), v('vendor:hitachi', 'Hitachi')])).toEqual([]);
    expect(planVendorMerges([v('vendor:mi', 'Mi'), v('vendor:microsoft', 'Microsoft', true)])).toEqual([]);
    // Two NVD-only spellings with a suffix difference: no KEV anchor, left alone.
    expect(planVendorMerges([v('vendor:acme', 'Acme'), v('vendor:acmecorp', 'Acmecorp')])).toEqual([]);
  });

  it('skips a suffix variant that would fit two KEV vendors', () => {
    expect(planVendorMerges([v('vendor:foo', 'Foo', true), v('vendor:foo-inc', 'Foo Inc', true), v('vendor:foocorp', 'Foocorp')])).toEqual([]);
  });
});

describe('merging in the store', () => {
  const seed = () => {
    const store = new Store(':memory:', () => '2026-10-31T00:00:00.000Z');
    for (const id of ['cisa-kev', 'nvd']) store.registerSource({ id, name: id, homepage: 'h', description: 'd' });
    store.writeBatch({
      nodes: [
        { id: 'cve:CVE-1', type: 'vulnerability', title: 'KEV one', occurredAt: '2026-10-30T00:00:00Z' },
        { id: 'cve:CVE-2', type: 'vulnerability', title: 'NVD two', occurredAt: '2026-10-30T00:00:00Z' },
        { id: 'vendor:palo-alto-networks', type: 'vendor', title: 'Palo Alto Networks', attrs: { wikidata: { status: 'matched', qid: 'Q7128508' } } },
        { id: 'product:palo-alto-networks/pan-os', type: 'product', title: 'Palo Alto Networks PAN-OS' },
        { id: 'vendor:paloaltonetworks', type: 'vendor', title: 'Paloaltonetworks', attrs: { wikidata: { status: 'none' } } },
        { id: 'product:paloaltonetworks/pan-os', type: 'product', title: 'Paloaltonetworks Pan Os' },
        { id: 'product:paloaltonetworks/globalprotect', type: 'product', title: 'Paloaltonetworks Globalprotect' },
      ],
      edges: [
        { src: 'cve:CVE-1', dst: 'product:palo-alto-networks/pan-os', rel: 'affects', basis: 'reported', confidence: 1, sourceId: 'cisa-kev' },
        { src: 'product:palo-alto-networks/pan-os', dst: 'vendor:palo-alto-networks', rel: 'made_by', basis: 'reported', confidence: 1, sourceId: 'cisa-kev' },
        { src: 'cve:CVE-1', dst: 'product:paloaltonetworks/pan-os', rel: 'affects', basis: 'reported', confidence: 1, sourceId: 'nvd' },
        { src: 'cve:CVE-2', dst: 'product:paloaltonetworks/globalprotect', rel: 'affects', basis: 'reported', confidence: 1, sourceId: 'nvd' },
        { src: 'product:paloaltonetworks/pan-os', dst: 'vendor:paloaltonetworks', rel: 'made_by', basis: 'reported', confidence: 1, sourceId: 'nvd' },
        { src: 'product:paloaltonetworks/globalprotect', dst: 'vendor:paloaltonetworks', rel: 'made_by', basis: 'reported', confidence: 1, sourceId: 'nvd' },
      ],
      provenance: [
        { nodeId: 'vendor:palo-alto-networks', sourceId: 'cisa-kev' },
        { nodeId: 'vendor:paloaltonetworks', sourceId: 'nvd', sourceUrl: 'https://nvd.nist.gov/' },
        { nodeId: 'product:palo-alto-networks/pan-os', sourceId: 'cisa-kev' },
        { nodeId: 'product:paloaltonetworks/pan-os', sourceId: 'nvd' },
        { nodeId: 'product:paloaltonetworks/globalprotect', sourceId: 'nvd' },
      ],
    });
    return store;
  };

  it('folds the duplicate vendor and its products into the KEV-named vendor', () => {
    const store = seed();
    expect(mergeDuplicateVendors(store)).toEqual({ vendors: 1, products: 2 });
    expect(store.getNode('vendor:paloaltonetworks')).toBeUndefined();
    expect(store.getNode('product:paloaltonetworks/pan-os')).toBeUndefined();

    const vendor = store.getNode('vendor:palo-alto-networks')!;
    expect(vendor.attrs.aliases).toEqual([{ id: 'vendor:paloaltonetworks', name: 'Paloaltonetworks', rule: 'exact' }]);
    expect(vendor.attrs.wikidata).toEqual({ status: 'matched', qid: 'Q7128508' }); // the survivor's lookup wins
    expect(store.provenanceFor(vendor.id).map((p) => p.id).sort()).toEqual(['cisa-kev', 'nvd']);

    // "Pan Os" and "PAN-OS" are one product; GlobalProtect is re-homed under the readable vendor name.
    const panos = store.edgesOf('product:palo-alto-networks/pan-os');
    expect(panos.filter((e) => e.rel === 'affects').map((e) => `${e.src}:${e.sourceId}`).sort()).toEqual(['cve:CVE-1:cisa-kev']);
    expect(store.getNode('product:palo-alto-networks/globalprotect')!.title).toBe('Palo Alto Networks Globalprotect');
    expect(store.edgesOf('product:palo-alto-networks/globalprotect').map((e) => e.rel).sort()).toEqual(['affects', 'made_by']);
    expect(store.counts()).toMatchObject({ vendor: 1, product: 2 });
  });

  it('is idempotent and survives NVD re-creating the duplicate on the next run', () => {
    const store = seed();
    mergeDuplicateVendors(store);
    const after = store.counts();
    expect(mergeDuplicateVendors(store)).toEqual({ vendors: 0, products: 0 });
    store.writeBatch({
      nodes: [{ id: 'vendor:paloaltonetworks', type: 'vendor', title: 'Paloaltonetworks' }, { id: 'product:paloaltonetworks/pan-os', type: 'product', title: 'Paloaltonetworks Pan Os' }],
      edges: [{ src: 'product:paloaltonetworks/pan-os', dst: 'vendor:paloaltonetworks', rel: 'made_by', basis: 'reported', confidence: 1, sourceId: 'nvd' }],
      provenance: [{ nodeId: 'vendor:paloaltonetworks', sourceId: 'nvd' }],
    });
    mergeDuplicateVendors(store);
    expect(store.counts()).toEqual(after);
    expect((store.getNode('vendor:palo-alto-networks')!.attrs.aliases as unknown[]).length).toBe(1);
  });
});
