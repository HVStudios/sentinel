import { emptyBatch, type Batch } from '../types.ts';
import { clamp01, toIso, type SourceModule } from './common.ts';

export const EONET_URL = 'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=30';
/** Sea and lake ice (iceberg tracking) is not a "significant world event" for SENTINEL. */
const EXCLUDED_CATEGORIES = new Set(['seaLakeIce']);
const MAX_TRACK_POINTS = 50;

interface EonetGeometry {
  date: string;
  type: string;
  coordinates: unknown;
  magnitudeValue?: number | null;
  magnitudeUnit?: string | null;
}

interface EonetEvent {
  id: string;
  title: string;
  description: string | null;
  link: string;
  closed: string | null;
  categories: { id: string; title: string }[];
  sources: { id: string; url: string }[];
  geometry: EonetGeometry[];
}

export interface EonetFeed {
  events: EonetEvent[];
}

const meta = {
  id: 'nasa-eonet',
  name: 'NASA Earth Observatory Natural Event Tracker',
  homepage: 'https://eonet.gsfc.nasa.gov/',
  description: 'Curated natural events (wildfires, storms, volcanoes, floods…) with source-reported coordinates.',
};

const isLonLat = (c: unknown): c is [number, number] =>
  Array.isArray(c) && c.length >= 2 && typeof c[0] === 'number' && typeof c[1] === 'number';

function severityFor(category: string, g: EonetGeometry | undefined): number {
  const v = g?.magnitudeValue;
  if (v == null) return 0.35;
  if (g?.magnitudeUnit === 'acres') return clamp01(Math.log10(Math.max(v, 1)) / 6); // 1M acres → 1
  if (g?.magnitudeUnit === 'kts') return clamp01(v / 150);
  return category === 'volcanoes' ? 0.6 : 0.35;
}

export function parseEonet(feed: EonetFeed): Batch & { skipped: number } {
  const b = { ...emptyBatch(), skipped: 0 };
  for (const ev of feed.events) {
    const category = ev.categories[0]?.id ?? 'other';
    if (EXCLUDED_CATEGORIES.has(category)) continue;
    // Only point geometries are used, verbatim. Polygons would require deriving a location.
    const points = ev.geometry
      .filter((g) => g.type === 'Point' && isLonLat(g.coordinates))
      .sort((a, c) => a.date.localeCompare(c.date));
    const latest = points.at(-1);
    if (!latest) {
      b.skipped++;
      continue;
    }
    const [lon, lat] = latest.coordinates as [number, number];
    const id = `eonet:${ev.id}`;
    b.nodes.push({
      id,
      type: 'natural_event',
      title: ev.title,
      summary:
        ev.description ??
        [ev.categories.map((c) => c.title).join(', '), latest.magnitudeValue != null ? `${latest.magnitudeValue} ${latest.magnitudeUnit ?? ''}`.trim() : null]
          .filter(Boolean)
          .join(' · '),
      url: ev.sources[0]?.url ?? ev.link,
      category,
      occurredAt: toIso(latest.date),
      publishedAt: toIso(points[0]!.date),
      lat,
      lon,
      geoBasis: 'coordinates',
      severity: severityFor(category, latest),
      attrs: {
        eonetId: ev.id,
        eonetUrl: ev.link,
        categories: ev.categories.map((c) => c.title),
        firstObserved: toIso(points[0]!.date),
        lastObserved: toIso(latest.date),
        magnitude: latest.magnitudeValue != null ? { value: latest.magnitudeValue, unit: latest.magnitudeUnit } : null,
        upstreamSources: ev.sources,
        track: points.slice(-MAX_TRACK_POINTS).map((g) => [...(g.coordinates as [number, number]), g.date]),
      },
    });
    b.provenance.push({ nodeId: id, sourceId: meta.id, sourceUrl: ev.link });
  }
  return b;
}

export const eonetSource: SourceModule = {
  meta,
  async run(ctx) {
    const { skipped, ...batch } = parseEonet(await ctx.fetchJson<EonetFeed>(EONET_URL, { timeoutMs: 60_000 }));
    if (skipped) ctx.log(`eonet: skipped ${skipped} events without point geometry`);
    return batch;
  },
};
