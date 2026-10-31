import { emptyBatch, type Batch, type SentinelNode } from '../types.ts';
import type { NodeRow } from '../store.ts';
import { RateLimiter } from '../http.ts';
import { toIso, type SourceModule } from './common.ts';

export const GDACS_API = 'https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH';
const WINDOW_DAYS = 30;
const MAX_PAGES = 5;
/** An event spread over more countries than this is not reduced to one point on the map. */
const MAX_COUNTRIES_FOR_POINT = 3;

/**
 * Queries: every Orange/Red alert, plus Green tropical cyclones and volcanoes. Green floods and
 * wildfires are numerous and low-impact; Green earthquakes are already covered by USGS.
 */
export const GDACS_QUERIES: Record<string, string>[] = [
  { alertlevel: 'orange;red' },
  { alertlevel: 'green', eventlist: 'TC;VO' },
];

const CATEGORY: Record<string, string> = { EQ: 'earthquake', TC: 'severeStorms', FL: 'floods', VO: 'volcanoes', DR: 'drought', WF: 'wildfires' };
const ALERT_SEVERITY: Record<string, number> = { Green: 0.35, Orange: 0.65, Red: 0.9 };

interface GdacsFeature {
  geometry: { type: string; coordinates: unknown } | null;
  properties: {
    eventtype: string;
    eventid: number;
    episodeid?: number;
    eventname?: string;
    name: string;
    htmldescription?: string;
    url?: { report?: string; details?: string } | string;
    alertlevel: string;
    country?: string;
    fromdate: string;
    todate: string;
    datemodified?: string;
    source?: string;
    polygonlabel?: string;
    affectedcountries?: { iso3: string; countryname: string }[];
    severitydata?: { severity: number; severitytext: string; severityunit: string };
  };
}

export interface GdacsResponse {
  features?: GdacsFeature[];
}

const meta = {
  id: 'gdacs',
  name: 'GDACS (Global Disaster Alert and Coordination System)',
  homepage: 'https://www.gdacs.org/',
  description:
    'UN/EU disaster alerts with impact-based alert levels. Points are GDACS-reported epicentres or centroids of the affected area.',
};

export const gdacsId = (p: GdacsFeature['properties']) => `gdacs:${p.eventtype}${p.eventid}`;

/** Great-circle distance in km. */
export function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

const stormKey = (s: string) => s.toLowerCase().replace(/-\d{2}$/, '').replace(/[^a-z]/g, '');

/**
 * Finds an existing node that describes the same event, so GDACS enriches it instead of drawing a
 * duplicate: earthquakes match a USGS quake within 2 minutes and 100 km; tropical cyclones match an
 * EONET storm whose title contains the storm's name.
 */
export function findExisting(f: GdacsFeature, existing: NodeRow[]): NodeRow | undefined {
  const p = f.properties;
  const coords = f.geometry?.type === 'Point' ? (f.geometry.coordinates as [number, number]) : null;
  if (p.eventtype === 'EQ' && coords) {
    const t = Date.parse(toIso(p.fromdate) ?? '');
    return existing.find(
      (n) =>
        n.id.startsWith('quake:') && n.lat != null && n.lon != null && n.occurredAt &&
        Math.abs(Date.parse(n.occurredAt) - t) <= 120_000 &&
        distanceKm({ lat: n.lat, lon: n.lon }, { lat: coords[1], lon: coords[0] }) <= 100,
    );
  }
  if (p.eventtype === 'TC' && p.eventname) {
    const key = stormKey(p.eventname);
    if (key.length < 3) return undefined;
    return existing.find((n) => n.id.startsWith('eonet:') && n.category === 'severeStorms' && stormKey(n.title).includes(key));
  }
  return undefined;
}

export function parseGdacs(resp: GdacsResponse, existing: NodeRow[] = []): Batch {
  const b = emptyBatch();
  const seen = new Set<string>();
  for (const f of resp.features ?? []) {
    const p = f.properties;
    const id = gdacsId(p);
    if (seen.has(id)) continue;
    seen.add(id);
    const report = typeof p.url === 'string' ? p.url : (p.url?.report ?? p.url?.details ?? null);
    const countries = (p.affectedcountries ?? []).map((c) => c.countryname);
    const gdacs = {
      eventId: p.eventid,
      eventType: p.eventtype,
      alertLevel: p.alertlevel,
      severity: p.severitydata?.severitytext ?? null,
      affectedCountries: countries,
      source: p.source ?? null,
      url: report,
      from: toIso(p.fromdate),
      to: toIso(p.todate),
    };
    const severity = ALERT_SEVERITY[p.alertlevel] ?? 0.35;

    const match = findExisting(f, existing);
    if (match) {
      // Same event already on the map from USGS/EONET: add GDACS's impact alert, keep the original point.
      b.nodes.push({ id: match.id, type: 'natural_event', title: '', severity: Math.max(match.severity ?? 0, severity), attrs: { gdacs } });
      b.provenance.push({ nodeId: match.id, sourceId: meta.id, sourceUrl: report });
      continue;
    }

    const coords = f.geometry?.type === 'Point' ? (f.geometry.coordinates as [number, number]) : null;
    // Continent-wide droughts and multi-country events have a centroid, but one dot would mislead.
    const placeable = coords && p.eventtype !== 'DR' && countries.length <= MAX_COUNTRIES_FOR_POINT;
    const node: SentinelNode = {
      id,
      type: 'natural_event',
      title: p.name.replace(/\s+/g, ' ').trim(),
      summary: [`GDACS ${p.alertlevel} alert`, p.severitydata?.severitytext, countries.length ? `Affected: ${countries.join(', ')}` : null]
        .filter(Boolean)
        .join(' · '),
      url: report,
      category: CATEGORY[p.eventtype] ?? p.eventtype.toLowerCase(),
      occurredAt: toIso(p.todate),
      publishedAt: toIso(p.fromdate),
      updatedAt: toIso(p.datemodified ?? null),
      severity,
      attrs: {
        gdacs,
        locationKind: placeable ? (p.eventtype === 'EQ' || p.eventtype === 'VO' ? 'epicentre' : 'centroid') : null,
      },
    };
    if (placeable) Object.assign(node, { lat: coords![1], lon: coords![0], geoBasis: 'coordinates' as const });
    b.nodes.push(node);
    b.provenance.push({ nodeId: id, sourceId: meta.id, sourceUrl: report });
  }
  return b;
}

export const gdacsSource: SourceModule = {
  meta,
  async run(ctx) {
    const now = ctx.now();
    const from = new Date(now.getTime() - WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
    const to = now.toISOString().slice(0, 10);
    const existing = ctx.store.nodesByType('natural_event');
    const limiter = new RateLimiter(2, 1_000);
    const features: GdacsFeature[] = [];
    for (const q of GDACS_QUERIES) {
      for (let page = 1; page <= MAX_PAGES; page++) {
        await limiter.acquire();
        const qs = new URLSearchParams({ fromdate: from, todate: to, ...q, pagenumber: String(page) });
        let resp: GdacsResponse;
        try {
          resp = await ctx.fetchJson<GdacsResponse>(`${GDACS_API}?${qs.toString().replace(/%3B/g, ';')}`);
        } catch (err) {
          // GDACS answers past the last page with an empty body, which is not JSON.
          if (page > 1 && /Invalid JSON/.test((err as Error).message)) break;
          throw err;
        }
        const page_ = resp.features ?? [];
        features.push(...page_);
        if (page_.length < 100) break;
      }
    }
    return parseGdacs({ features }, existing);
  },
};
