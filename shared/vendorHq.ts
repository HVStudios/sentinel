/**
 * Where the vendors behind an item are headquartered, according to Wikidata, for the selection
 * lines on the map. Follows explicit, reported links only:
 * - vulnerability: affects → product → made_by → vendor;
 * - product:       made_by → vendor;
 * - vendor:        itself.
 * Only confident identity matches are used (confidence ≥ 0.7, as for the vendor HQ layer); possible
 * matches are never placed on the map. Shared by the server API and the static (GitHub Pages) engine.
 */

interface HqNode {
  id: string;
  type: string;
  title: string;
  attrs?: Record<string, unknown> | null;
}
interface HqEdge {
  src: string;
  dst: string;
  rel: string;
}
export interface HqLookup {
  node(id: string): HqNode | undefined;
  edges(id: string): HqEdge[];
}

/** A vendor headquarters linked to an item. The link to the vendor is reported (NVD, KEV, GHSA); the HQ comes from Wikidata. */
export interface ItemVendorHq {
  id: string;
  title: string;
  lat: number;
  lon: number;
  hq: string;
  country: string | null;
  /** The products that link the item to this vendor (empty for the vendor itself). */
  via: string[];
}

export const MIN_HQ_CONFIDENCE = 0.7;

interface Wikidata {
  status?: string;
  confidence?: number;
  hq?: { label?: string; country?: string | null; lat?: number | null; lon?: number | null };
}

function hqOf(n: HqNode | undefined): Omit<ItemVendorHq, 'via'> | null {
  const wd = n?.attrs?.wikidata as Wikidata | undefined;
  if (!n || n.type !== 'vendor' || wd?.status !== 'matched' || !((wd.confidence ?? 0) >= MIN_HQ_CONFIDENCE)) return null;
  if (wd.hq?.lat == null || wd.hq?.lon == null) return null;
  return { id: n.id, title: n.title, lat: wd.hq.lat, lon: wd.hq.lon, hq: wd.hq.label ?? '', country: wd.hq.country ?? null };
}

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function vendorHqsFor(lookup: HqLookup, id: string): ItemVendorHq[] {
  const root = lookup.node(id);
  if (!root) return [];
  const vendors = new Map<string, Set<string>>();
  const add = (vendorId: string, via: string | null) => {
    const set = vendors.get(vendorId) ?? new Set<string>();
    if (via) set.add(via);
    vendors.set(vendorId, set);
  };
  const madeBy = (productId: string, via: string | null) => {
    for (const m of lookup.edges(productId)) if (m.rel === 'made_by' && m.src === productId) add(m.dst, via);
  };
  if (root.type === 'vendor') add(root.id, null);
  else if (root.type === 'product') madeBy(root.id, null);
  else if (root.type === 'vulnerability') {
    for (const a of lookup.edges(root.id)) if (a.rel === 'affects' && a.src === root.id) madeBy(a.dst, lookup.node(a.dst)?.title ?? a.dst);
  }
  const out: ItemVendorHq[] = [];
  for (const [vendorId, via] of vendors) {
    const hq = hqOf(lookup.node(vendorId));
    if (hq) out.push({ ...hq, via: [...via].sort(byText) });
  }
  return out.sort((a, b) => byText(a.id, b.id));
}
