/**
 * Countries GDACS reports as affected by disaster events, as an optional map layer. These are the
 * countries GDACS itself lists for each event (reported, not inferred), keyed by GDACS's spelling;
 * the map resolves them to its base-map names and lists any it cannot draw.
 */
export interface AffectedCountry {
  country: string;
  maxAlert: 'Green' | 'Orange' | 'Red';
  events: { id: string; title: string; alertLevel: string }[];
}

const ALERT_RANK: Record<string, number> = { Green: 1, Orange: 2, Red: 3 };

/** Used by Store.mapData and the static engine. Order: most severe alert first, then name (code-unit order, like SQLite). */
export function aggregateAffected(nodes: { id: string; title: string; attrs: Record<string, unknown> }[]): AffectedCountry[] {
  const byCountry = new Map<string, AffectedCountry>();
  for (const n of nodes) {
    const g = n.attrs.gdacs as { affectedCountries?: string[]; alertLevel?: string } | undefined;
    if (!g?.affectedCountries?.length || !g.alertLevel) continue;
    for (const raw of g.affectedCountries) {
      const country = raw.replace(/\s+/g, ' ').trim();
      const entry = byCountry.get(country) ?? { country, maxAlert: 'Green' as const, events: [] };
      entry.events.push({ id: n.id, title: n.title, alertLevel: g.alertLevel });
      if ((ALERT_RANK[g.alertLevel] ?? 0) > ALERT_RANK[entry.maxAlert]!) entry.maxAlert = g.alertLevel as AffectedCountry['maxAlert'];
      byCountry.set(country, entry);
    }
  }
  const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  for (const c of byCountry.values()) {
    c.events.sort((a, b) => (ALERT_RANK[b.alertLevel] ?? 0) - (ALERT_RANK[a.alertLevel] ?? 0) || byText(a.title, b.title) || byText(a.id, b.id));
  }
  return [...byCountry.values()].sort((a, b) => ALERT_RANK[b.maxAlert]! - ALERT_RANK[a.maxAlert]! || (a.country < b.country ? -1 : a.country > b.country ? 1 : 0));
}
