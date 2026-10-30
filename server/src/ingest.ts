import type { Store } from './store.ts';
import { fetchJson, fetchText } from './http.ts';
import { runInference } from './relate.ts';
import type { IngestContext, SourceModule } from './sources/common.ts';
import { kevSource } from './sources/kev.ts';
import { nvdSource } from './sources/nvd.ts';
import { epssSource } from './sources/epss.ts';
import { usgsSource } from './sources/usgs.ts';
import { eonetSource } from './sources/eonet.ts';
import { gdeltSource } from './sources/gdelt.ts';
import { hnSource } from './sources/hn.ts';
import { rssSource } from './sources/rss.ts';

/** Run order matters: NVD and EPSS enrich CVEs that KEV created. */
export const SOURCES: SourceModule[] = [kevSource, nvdSource, epssSource, usgsSource, eonetSource, rssSource, gdeltSource, hnSource];

export interface IngestResult {
  source: string;
  status: 'ok' | 'error';
  count: number;
  durationMs: number;
  error?: string;
}

export interface IngestOptions {
  only?: string[];
  sources?: SourceModule[];
  ctx?: Partial<Omit<IngestContext, 'store'>>;
}

/** Runs each source independently; a failing source is recorded and never aborts the run. */
export async function ingest(store: Store, opts: IngestOptions = {}): Promise<{ results: IngestResult[]; inferredEdges: number }> {
  const ctx: IngestContext = {
    store,
    fetchJson,
    fetchText,
    env: process.env,
    now: () => new Date(),
    log: (m) => console.log(m),
    ...opts.ctx,
  };
  const sources = (opts.sources ?? SOURCES).filter((s) => !opts.only?.length || opts.only.includes(s.meta.id));
  const results: IngestResult[] = [];

  for (const source of sources) {
    store.registerSource(source.meta);
    const started = Date.now();
    try {
      const { warnings, ...batch } = await source.run(ctx);
      store.writeBatch(batch);
      const r: IngestResult = { source: source.meta.id, status: 'ok', count: batch.nodes.length, durationMs: Date.now() - started };
      // Partial problems keep the source "ok" but stay visible in its status.
      if (warnings?.length) r.error = warnings.join('; ');
      store.recordSourceRun(source.meta.id, r);
      results.push(r);
      ctx.log(`✓ ${source.meta.id}: ${r.count} nodes in ${r.durationMs} ms${r.error ? ` (warnings: ${r.error})` : ''}`);
    } catch (err) {
      const r = { source: source.meta.id, status: 'error' as const, count: 0, durationMs: Date.now() - started, error: (err as Error).message };
      store.recordSourceRun(source.meta.id, r);
      results.push(r);
      ctx.log(`✗ ${source.meta.id}: ${r.error}`);
    }
  }

  const { edges } = runInference(store);
  ctx.log(`✓ inference: ${edges} inferred edges`);
  return { results, inferredEdges: edges };
}
