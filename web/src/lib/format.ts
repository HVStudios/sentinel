import type { NodeType, SNode } from '../api.ts';

export const TYPE_LABEL: Record<NodeType, string> = {
  vulnerability: 'Vulnerability',
  natural_event: 'World event',
  article: 'News & tech',
  vendor: 'Vendor',
  product: 'Product',
  weakness: 'Weakness (CWE)',
  source: 'Source',
};

export const CATEGORY_LABEL: Record<string, string> = {
  kev: 'Known exploited',
  cve: 'New CVE',
  ghsa: 'GitHub advisory',
  earthquake: 'Earthquake',
  wildfires: 'Wildfire',
  severeStorms: 'Severe storm',
  volcanoes: 'Volcano',
  floods: 'Flood',
  drought: 'Drought',
  dustHaze: 'Dust & haze',
  landslides: 'Landslide',
  manmade: 'Manmade',
  snow: 'Snow',
  tempExtremes: 'Temperature extreme',
  waterColor: 'Water colour',
  'security-news': 'Security news',
  advisory: 'Advisory',
  'tech-news': 'Tech news',
  ai: 'AI',
  tech: 'Tech',
};

export const categoryLabel = (c: string | null | undefined) => (c ? (CATEGORY_LABEL[c] ?? c) : '');

export function relativeTime(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return 'unknown time';
  const diff = now.getTime() - Date.parse(iso);
  const abs = Math.abs(diff);
  const units: [number, string][] = [
    [365 * 86_400_000, 'y'],
    [30 * 86_400_000, 'mo'],
    [86_400_000, 'd'],
    [3_600_000, 'h'],
    [60_000, 'm'],
  ];
  for (const [ms, label] of units) {
    if (abs >= ms) {
      const v = Math.floor(abs / ms);
      return diff >= 0 ? `${v}${label} ago` : `in ${v}${label}`;
    }
  }
  return 'just now';
}

export const formatDate = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toISOString().replace('T', ' ').replace(/:\d{2}\.\d{3}Z$/, ' UTC') : '—';

/** A short, honest description of where an item is, and on what basis. */
export function locationLabel(n: Pick<SNode, 'geoBasis' | 'lat' | 'lon' | 'country' | 'attrs' | 'type'>): string {
  if (n.geoBasis === 'coordinates' && n.lat != null && n.lon != null) {
    const place = typeof n.attrs?.place === 'string' ? `${n.attrs.place} · ` : '';
    const kind = n.attrs?.locationKind === 'centroid' ? 'GDACS centroid of the affected area' : 'source coordinates';
    return `${place}${n.lat.toFixed(2)}°, ${n.lon.toFixed(2)}° (${kind})`;
  }
  const affected: string[] | undefined = n.attrs?.gdacs?.affectedCountries;
  if (n.type === 'natural_event' && affected?.length)
    return `Not shown as a point: affects ${affected.length} ${affected.length === 1 ? 'country' : 'countries'} (GDACS)`;
  if (n.geoBasis === 'publisher_country' && n.country) return `Publisher in ${n.country} (not the event location)`;
  const wd = n.attrs?.wikidata;
  if (n.type === 'vendor' && wd?.status === 'matched' && wd.hq) {
    const where = `${wd.hq.label}${wd.hq.country ? `, ${wd.hq.country}` : ''}`;
    // Alias-only identity matches are too uncertain to place on the map.
    return wd.confidence >= 0.7 ? `Headquarters: ${where} (Wikidata)` : `Possibly headquartered in ${where} (Wikidata alias match; not mapped)`;
  }
  return 'No location reported by source';
}

export interface Badge {
  label: string;
  tone: 'critical' | 'high' | 'medium' | 'low' | 'info';
  title: string;
}

const cvssTone = (score: number): Badge['tone'] => (score >= 9 ? 'critical' : score >= 7 ? 'high' : score >= 4 ? 'medium' : 'low');

export function badgesFor(n: SNode): Badge[] {
  const out: Badge[] = [];
  const a = n.attrs ?? {};
  if (n.type === 'vulnerability') {
    if (a.kev) out.push({ label: 'KEV', tone: 'critical', title: `In CISA KEV since ${a.kev.dateAdded}; due ${a.kev.dueDate}` });
    if (a.kev?.ransomware === 'Known') out.push({ label: 'Ransomware', tone: 'critical', title: 'Known use in ransomware campaigns (CISA)' });
    if (a.cvss?.score != null)
      out.push({ label: `CVSS ${a.cvss.score.toFixed(1)}`, tone: cvssTone(a.cvss.score), title: `CVSS v${a.cvss.version} ${a.cvss.vector} (${a.cvss.source})` });
    if (a.epss?.score != null)
      out.push({
        label: `EPSS ${(a.epss.score * 100).toFixed(a.epss.score < 0.1 ? 1 : 0)}%`,
        tone: a.epss.score >= 0.5 ? 'high' : a.epss.score >= 0.1 ? 'medium' : 'low',
        title: `Exploitation probability (30 days), percentile ${(a.epss.percentile * 100).toFixed(0)} — FIRST EPSS ${a.epss.date}`,
      });
  }
  if (a.ghsa) {
    const ecosystems = [...new Set((a.ghsa.packages ?? []).map((p: { ecosystem: string }) => p.ecosystem))].join(', ');
    out.push({ label: 'GHSA', tone: a.ghsa.severity === 'critical' ? 'critical' : 'high', title: `GitHub-reviewed advisory ${a.ghsa.id} (${a.ghsa.severity})${ecosystems ? `: ${ecosystems}` : ''}` });
  }
  if (a.gdacs?.alertLevel) {
    const tone = a.gdacs.alertLevel === 'Red' ? 'critical' : a.gdacs.alertLevel === 'Orange' ? 'high' : 'low';
    out.push({ label: `GDACS ${a.gdacs.alertLevel}`, tone, title: 'GDACS impact-based alert level (Green, Orange, Red)' });
  }
  if (n.type === 'natural_event') {
    if (a.mag != null) out.push({ label: `M${Number(a.mag).toFixed(1)}`, tone: a.mag >= 7 ? 'critical' : a.mag >= 6 ? 'high' : 'medium', title: `Magnitude (${a.magType ?? 'n/a'})` });
    if (a.alert) out.push({ label: `PAGER ${a.alert}`, tone: a.alert === 'red' ? 'critical' : a.alert === 'orange' ? 'high' : 'medium', title: 'USGS PAGER impact alert level' });
    if (a.tsunami) out.push({ label: 'Tsunami flag', tone: 'high', title: 'USGS tsunami flag (not a warning; see NOAA)' });
    if (a.magnitude) out.push({ label: `${a.magnitude.value} ${a.magnitude.unit ?? ''}`.trim(), tone: 'info', title: 'Magnitude reported by EONET source' });
  }
  if (n.type === 'article' && a.points != null) out.push({ label: `▲ ${a.points}`, tone: 'info', title: `${a.points} points, ${a.comments} comments on Hacker News` });
  return out;
}

export const sourceDomain = (n: SNode): string | null =>
  typeof n.attrs?.domain === 'string' ? n.attrs.domain : n.url ? new URL(n.url).hostname.replace(/^www\./, '') : null;
