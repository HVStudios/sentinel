import { emptyBatch, type Batch } from '../types.ts';
import { clamp01, type SourceModule } from './common.ts';

/** Significant quakes (any magnitude) for the month plus all M4.5+ for the week. */
export const USGS_FEEDS = [
  'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_month.geojson',
  'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson',
];

interface UsgsFeature {
  id: string;
  properties: {
    mag: number | null;
    magType?: string;
    place: string | null;
    time: number;
    updated: number;
    url: string;
    alert: string | null;
    tsunami: number;
    sig: number;
    status: string;
    type: string;
    title: string;
    felt?: number | null;
  };
  geometry: { type: 'Point'; coordinates: [number, number, number?] } | null;
}

export interface UsgsFeed {
  metadata: { url: string; title: string; generated: number };
  features: UsgsFeature[];
}

const meta = {
  id: 'usgs-earthquakes',
  name: 'USGS Earthquake Hazards Program',
  homepage: 'https://earthquake.usgs.gov/earthquakes/feed/',
  description: 'Real-time earthquake locations and magnitudes reported by the U.S. Geological Survey.',
};

export function parseUsgs(feed: UsgsFeed): Batch {
  const b = emptyBatch();
  for (const f of feed.features) {
    if (f.geometry?.type !== 'Point') continue;
    const [lon, lat, depth] = f.geometry.coordinates;
    const p = f.properties;
    const id = `quake:${f.id}`;
    b.nodes.push({
      id,
      type: 'natural_event',
      title: p.title,
      summary: [
        p.mag != null ? `Magnitude ${p.mag}${p.magType ? ` (${p.magType})` : ''}` : null,
        depth != null ? `depth ${depth.toFixed(1)} km` : null,
        p.alert ? `PAGER alert: ${p.alert}` : null,
        p.tsunami ? 'tsunami flag set' : null,
      ]
        .filter(Boolean)
        .join(', '),
      url: p.url,
      category: p.type === 'earthquake' ? 'earthquake' : p.type,
      occurredAt: new Date(p.time).toISOString(),
      updatedAt: new Date(p.updated).toISOString(),
      lat,
      lon,
      geoBasis: 'coordinates',
      // M4 → 0, M9 → 1.
      severity: p.mag != null ? clamp01((p.mag - 4) / 5) : null,
      attrs: {
        mag: p.mag,
        magType: p.magType ?? null,
        place: p.place,
        depthKm: depth ?? null,
        alert: p.alert,
        tsunami: Boolean(p.tsunami),
        significance: p.sig,
        reviewStatus: p.status,
        felt: p.felt ?? null,
      },
    });
    b.provenance.push({ nodeId: id, sourceId: meta.id, sourceUrl: feed.metadata.url });
  }
  return b;
}

export const usgsSource: SourceModule = {
  meta,
  async run(ctx) {
    const out = emptyBatch();
    for (const url of USGS_FEEDS) {
      const part = parseUsgs(await ctx.fetchJson<UsgsFeed>(url));
      out.nodes.push(...part.nodes);
      out.provenance.push(...part.provenance);
    }
    return out;
  },
};
