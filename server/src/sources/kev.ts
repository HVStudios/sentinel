import { emptyBatch, type Batch } from '../types.ts';
import { cveNodeId, cweNodeId, cweUrl, nvdUrl, productNodeId, toIso, vendorNodeId, type SourceModule } from './common.ts';

export const KEV_URL = 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json';

interface KevEntry {
  cveID: string;
  vendorProject: string;
  product: string;
  vulnerabilityName: string;
  dateAdded: string;
  shortDescription: string;
  requiredAction: string;
  dueDate: string;
  knownRansomwareCampaignUse: string;
  notes?: string;
  cwes?: string[];
}

export interface KevFeed {
  catalogVersion: string;
  dateReleased: string;
  vulnerabilities: KevEntry[];
}

const meta = {
  id: 'cisa-kev',
  name: 'CISA Known Exploited Vulnerabilities',
  homepage: 'https://www.cisa.gov/known-exploited-vulnerabilities-catalog',
  description: 'Vulnerabilities CISA has confirmed are exploited in the wild, with remediation due dates.',
};

export function parseKev(feed: KevFeed): Batch {
  const b = emptyBatch();
  const refs = new Set<string>();
  const ref = (node: Batch['nodes'][number]) => {
    if (refs.has(node.id)) return;
    refs.add(node.id);
    b.nodes.push(node);
    b.provenance.push({ nodeId: node.id, sourceId: meta.id, sourceUrl: meta.homepage });
  };

  for (const raw of feed.vulnerabilities) {
    // KEV occasionally has stray whitespace in names ("Array Networks ").
    const v = { ...raw, vendorProject: raw.vendorProject.trim(), product: raw.product.trim() };
    const id = cveNodeId(v.cveID);
    const notes = (v.notes ?? '')
      .split(';')
      .map((s) => s.trim().replace(/^[^:]*?:\s*(?=https?:)/, ''))
      .filter((s) => /^https?:\/\//.test(s));
    b.nodes.push({
      id,
      type: 'vulnerability',
      title: v.vulnerabilityName || v.cveID,
      summary: v.shortDescription,
      url: nvdUrl(v.cveID),
      category: 'kev',
      occurredAt: toIso(v.dateAdded),
      attrs: {
        cveId: v.cveID,
        kev: {
          dateAdded: v.dateAdded,
          dueDate: v.dueDate,
          requiredAction: v.requiredAction,
          description: v.shortDescription,
          ransomware: v.knownRansomwareCampaignUse,
          vendorProject: v.vendorProject,
          product: v.product,
          notes,
          catalogVersion: feed.catalogVersion,
        },
      },
    });
    b.provenance.push({ nodeId: id, sourceId: meta.id, sourceUrl: meta.homepage });

    const vendorId = vendorNodeId(v.vendorProject);
    const productId = productNodeId(v.vendorProject, v.product);
    ref({ id: vendorId, type: 'vendor', title: v.vendorProject });
    ref({ id: productId, type: 'product', title: `${v.vendorProject} ${v.product}`, attrs: { vendor: v.vendorProject } });
    b.edges.push(
      { src: id, dst: productId, rel: 'affects', basis: 'reported', confidence: 1, sourceId: meta.id },
      { src: productId, dst: vendorId, rel: 'made_by', basis: 'reported', confidence: 1, sourceId: meta.id },
    );
    for (const cwe of v.cwes ?? []) {
      if (!/^CWE-\d+$/i.test(cwe)) continue;
      ref({ id: cweNodeId(cwe), type: 'weakness', title: cwe.toUpperCase(), url: cweUrl(cwe) });
      b.edges.push({ src: id, dst: cweNodeId(cwe), rel: 'has_weakness', basis: 'reported', confidence: 1, sourceId: meta.id });
    }
  }
  return b;
}

export const kevSource: SourceModule = {
  meta,
  async run(ctx) {
    return parseKev(await ctx.fetchJson<KevFeed>(KEV_URL, { timeoutMs: 60_000 }));
  },
};
