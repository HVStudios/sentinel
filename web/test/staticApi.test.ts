import { describe, expect, it, vi } from 'vitest';
import { createStaticApi, type Snapshot } from '../src/staticApi.ts';
import { article, kevCve, quake } from './fixtures.ts';

const snapshot: Snapshot = {
  format: 1,
  version: '0.1.0',
  generatedAt: '2026-10-30T18:00:00.000Z',
  sources: [{ id: 'usgs-earthquakes', name: 'USGS', homepage: 'h', description: 'd', lastRunAt: null, lastStatus: 'ok', lastCount: 1, lastError: null, lastDurationMs: 1 }],
  nodes: [kevCve, quake, article],
  edges: [{ src: article.id, dst: kevCve.id, rel: 'mentions', basis: 'inferred', confidence: 0.95, rationale: 'r', sourceId: 'sentinel-inference', observedAt: '' }],
  provenance: [{ nodeId: quake.id, sourceId: 'usgs-earthquakes', sourceUrl: 'https://earthquake.usgs.gov', fetchedAt: '2026-10-30T18:00:00.000Z' }],
};

describe('static API', () => {
  it('downloads the snapshot once and answers every query from it', async () => {
    const load = vi.fn().mockResolvedValue(snapshot);
    const api = createStaticApi(load);
    expect(api.mode).toBe('static');
    const all = { types: ['vulnerability', 'natural_event', 'article'] as const };
    expect((await api.feed({ ...all, types: [...all.types] })).items).toHaveLength(3);
    expect((await api.map({ types: [...all.types] })).countries).toEqual([{ country: 'Germany', count: 1 }]);
    const detail = await api.node(quake.id);
    expect(detail.provenance[0]).toMatchObject({ name: 'USGS', sourceUrl: 'https://earthquake.usgs.gov' });
    expect((await api.graph(kevCve.id, 1)).nodes).toHaveLength(2);
    expect((await api.sources()).generatedAt).toBe('2026-10-30T18:00:00.000Z');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('retries the download after a failure', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(snapshot);
    const api = createStaticApi(load);
    await expect(api.sources()).rejects.toThrow('offline');
    await expect(api.sources()).resolves.toHaveProperty('sources');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('cannot trigger an ingest', async () => {
    await expect(createStaticApi(async () => snapshot).startIngest()).rejects.toThrow(/static snapshot/);
  });
});
