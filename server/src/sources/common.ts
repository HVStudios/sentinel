import { createHash } from 'node:crypto';
import { productNodeId, slug, vendorNodeId } from '../../../shared/ids.ts';

export { productNodeId, slug, vendorNodeId };
import type { Batch, SourceMeta } from '../types.ts';
import type { Store } from '../store.ts';
import type { fetchJson, fetchJsonWithHeaders, fetchText } from '../http.ts';

export interface IngestContext {
  store: Store;
  fetchJson: typeof fetchJson;
  fetchText: typeof fetchText;
  fetchJsonWithHeaders: typeof fetchJsonWithHeaders;
  env: Record<string, string | undefined>;
  now: () => Date;
  log: (msg: string) => void;
}

/** A batch plus non-fatal problems (e.g. 2 of 23 feeds failed), shown in the source status. */
export type SourceResult = Batch & { warnings?: string[] };

export interface SourceModule {
  meta: SourceMeta;
  run(ctx: IngestContext): Promise<SourceResult>;
}

export const sha1 = (s: string): string => createHash('sha1').update(s).digest('hex').slice(0, 16);

export const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/** Dates like `2024-05-02` → `2024-05-02T00:00:00.000Z`; NVD's zone-less timestamps are UTC. */
export const toIso = (s: string | null | undefined): string | null => {
  if (!s) return null;
  const v = /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : /[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s : `${s}Z`;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};

export const cveNodeId = (cve: string) => `cve:${cve.toUpperCase()}`;
export const cweNodeId = (cwe: string) => `cwe:${cwe.toUpperCase()}`;
export const nvdUrl = (cve: string) => `https://nvd.nist.gov/vuln/detail/${cve.toUpperCase()}`;
export const cweUrl = (cwe: string) => `https://cwe.mitre.org/data/definitions/${cwe.replace(/^CWE-/i, '')}.html`;
