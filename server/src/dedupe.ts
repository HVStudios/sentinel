import type { NodeRow, Store } from './store.ts';
import { slug } from './sources/common.ts';

/**
 * Vendor de-duplication. KEV writes vendors readably ("Palo Alto Networks", "D-Link"); NVD CPE
 * IDs run them together ("paloaltonetworks", "dlink") or add suffixes ("zohocorp", "sudo_project").
 * Without merging, one company becomes two vendor nodes and its relationships are split.
 *
 * Rules, deliberately conservative:
 * 1. exact: names identical once separators are removed are the same vendor;
 * 2. suffix: a name that differs from a KEV-named vendor only by a trailing legal/descriptive word
 *    (Inc, Corp, GmbH, Project, Networks, Security…) is merged into that vendor, but only when
 *    exactly one KEV vendor matches. Prefix matches are never used ("Intellian" is not "Intel").
 * The surviving vendor keeps every other name in `attrs.aliases` with the rule that matched.
 */

export const STRIPPABLE_SUFFIXES = [
  'inc', 'incorporated', 'corp', 'corporation', 'co', 'company', 'ltd', 'limited', 'llc', 'gmbh', 'ag', 'sa', 'kk', 'bv', 'plc',
  'project', 'foundation', 'association', 'group',
  'networks', 'network', 'systems', 'security', 'software', 'technologies', 'technology', 'tech', 'labs', 'automation', 'healthcare',
];
const MIN_KEY = 4;

/** "Palo Alto Networks" → "paloaltonetworks". */
export const compactKey = (name: string): string => slug(name).replace(/-/g, '');

/** Keys with trailing suffix words removed, both as separate tokens and run together ("zohocorp" → "zoho"). */
export function strippedKeys(name: string): string[] {
  const out = new Set<string>();
  const tokens = slug(name).split('-').filter(Boolean);
  while (tokens.length > 1 && STRIPPABLE_SUFFIXES.includes(tokens.at(-1)!)) {
    tokens.pop();
    out.add(tokens.join(''));
  }
  let compact = compactKey(name);
  for (let changed = true; changed; ) {
    changed = false;
    for (const s of STRIPPABLE_SUFFIXES) {
      if (compact.endsWith(s) && compact.length - s.length >= MIN_KEY) {
        compact = compact.slice(0, -s.length);
        out.add(compact);
        changed = true;
        break;
      }
    }
  }
  return [...out].filter((k) => k.length >= MIN_KEY && k !== compactKey(name));
}

export interface VendorInfo {
  id: string;
  title: string;
  /** Named by CISA KEV (the readable spelling we prefer to keep). */
  kev: boolean;
  /** Number of products, used as a tie-breaker. */
  products: number;
}

export interface MergePlan {
  from: string;
  into: string;
  rule: 'exact' | 'suffix';
}

const readable = (t: string) => /[\s-]|[a-z][A-Z]/.test(t.trim());

/** Pure planning step: which vendor nodes should be merged into which. */
export function planVendorMerges(vendors: VendorInfo[]): MergePlan[] {
  const plans: MergePlan[] = [];
  const merged = new Set<string>();
  const rank = (a: VendorInfo, b: VendorInfo) =>
    Number(b.kev) - Number(a.kev) || Number(readable(b.title)) - Number(readable(a.title)) || b.products - a.products || a.id.localeCompare(b.id);

  // Rule 1: identical compact names.
  const byKey = new Map<string, VendorInfo[]>();
  for (const v of vendors) {
    const k = compactKey(v.title);
    if (k.length < 2) continue;
    byKey.set(k, [...(byKey.get(k) ?? []), v]);
  }
  for (const group of byKey.values()) {
    if (group.length < 2) continue;
    const [keep, ...rest] = [...group].sort(rank);
    for (const v of rest) {
      plans.push({ from: v.id, into: keep!.id, rule: 'exact' });
      merged.add(v.id);
    }
  }

  // Rule 2: suffix variants, merged only into a single KEV-named vendor.
  const kevByKey = new Map<string, VendorInfo[]>();
  for (const v of vendors) {
    if (!v.kev || merged.has(v.id)) continue;
    for (const k of [compactKey(v.title), ...strippedKeys(v.title)]) kevByKey.set(k, [...(kevByKey.get(k) ?? []), v]);
  }
  for (const v of vendors) {
    if (v.kev || merged.has(v.id)) continue;
    const targets = new Map<string, VendorInfo>();
    for (const k of [compactKey(v.title), ...strippedKeys(v.title)]) {
      if (k.length < MIN_KEY) continue;
      for (const t of kevByKey.get(k) ?? []) if (t.id !== v.id) targets.set(t.id, t);
    }
    if (targets.size === 1) {
      plans.push({ from: v.id, into: [...targets.keys()][0]!, rule: 'suffix' });
      merged.add(v.id);
    }
  }
  return plans;
}

const productPart = (product: NodeRow, vendorTitle: string): string => {
  const t = product.title.trim();
  return t.toLowerCase().startsWith(`${vendorTitle.trim().toLowerCase()} `) ? t.slice(vendorTitle.trim().length + 1) : t;
};

/** Applies the plan: moves products under the surviving vendor, merges duplicates, records aliases. */
export function mergeDuplicateVendors(store: Store): { vendors: number; products: number } {
  const vendorRows = store.nodesByType('vendor');
  const products = store.nodesByType('product');
  const kev = new Set(store.idsWithProvenance('cisa-kev'));
  const productsOf = new Map<string, NodeRow[]>();
  for (const p of products) {
    const vendorId = store.edgesOf(p.id).find((e) => e.rel === 'made_by' && e.src === p.id)?.dst;
    if (vendorId) productsOf.set(vendorId, [...(productsOf.get(vendorId) ?? []), p]);
  }
  const plans = planVendorMerges(
    vendorRows.map((v) => ({ id: v.id, title: v.title, kev: kev.has(v.id), products: productsOf.get(v.id)?.length ?? 0 })),
  );
  if (!plans.length) return { vendors: 0, products: 0 };

  const byId = new Map(vendorRows.map((v) => [v.id, v]));
  let movedProducts = 0;
  store.transaction(() => {
    for (const plan of plans) {
      const from = byId.get(plan.from)!;
      const into = byId.get(plan.into)!;
      // Products: same product name under the surviving vendor → merge; otherwise re-home under it.
      const existing = new Map((productsOf.get(into.id) ?? []).map((p) => [compactKey(productPart(p, into.title)), p]));
      for (const p of productsOf.get(from.id) ?? []) {
        const part = productPart(p, from.title);
        const target = existing.get(compactKey(part));
        const targetId = target?.id ?? `product:${into.id.slice('vendor:'.length)}/${slug(part)}`;
        if (targetId === p.id) continue;
        if (!target) store.copyNode(p.id, targetId, `${into.title.trim()} ${part}`);
        store.mergeNode(p.id, targetId);
        movedProducts++;
      }
      store.mergeNode(from.id, into.id, { alias: { id: from.id, name: from.title.trim(), rule: plan.rule } });
    }
  });
  return { vendors: plans.length, products: movedProducts };
}
