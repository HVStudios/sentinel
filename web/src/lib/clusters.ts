/**
 * Screen-space clustering for map points. Points closer than `radius` (in the same units as x/y,
 * usually map units = screen pixels ÷ zoom) merge into one cluster. Greedy and deterministic: the
 * heaviest remaining point seeds a cluster and absorbs its unassigned neighbours, so the most severe
 * event decides where a cluster sits and the result does not depend on input order.
 */
export interface Placed<T> {
  id: string;
  x: number;
  y: number;
  weight: number;
  item: T;
}

export interface Cluster<T> {
  /** Stable while the membership is: `cluster:` + the seed's id. */
  id: string;
  x: number;
  y: number;
  members: Placed<T>[];
}

export function clusterPoints<T>(points: Placed<T>[], radius: number, keepApart: (id: string) => boolean = () => false): { singles: Placed<T>[]; clusters: Cluster<T>[] } {
  if (!(radius > 0)) return { singles: points, clusters: [] };
  const cell = radius;
  const grid = new Map<string, Placed<T>[]>();
  const key = (cx: number, cy: number) => `${cx}|${cy}`;
  for (const p of points) {
    if (keepApart(p.id)) continue;
    const k = key(Math.floor(p.x / cell), Math.floor(p.y / cell));
    const bucket = grid.get(k);
    if (bucket) bucket.push(p);
    else grid.set(k, [p]);
  }
  const seeds = [...points].sort((a, b) => b.weight - a.weight || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const taken = new Set<string>();
  const singles: Placed<T>[] = [];
  const clusters: Cluster<T>[] = [];
  const r2 = radius * radius;
  for (const s of seeds) {
    if (taken.has(s.id)) continue;
    taken.add(s.id);
    if (keepApart(s.id)) {
      singles.push(s);
      continue;
    }
    const members = [s];
    const cx = Math.floor(s.x / cell);
    const cy = Math.floor(s.y / cell);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const p of grid.get(key(cx + dx, cy + dy)) ?? []) {
          if (taken.has(p.id)) continue;
          if ((p.x - s.x) ** 2 + (p.y - s.y) ** 2 < r2) {
            taken.add(p.id);
            members.push(p);
          }
        }
      }
    }
    if (members.length === 1) singles.push(s);
    else
      clusters.push({
        id: `cluster:${s.id}`,
        x: members.reduce((a, m) => a + m.x, 0) / members.length,
        y: members.reduce((a, m) => a + m.y, 0) / members.length,
        members,
      });
  }
  // Keep the original (paint) order for singles, so severe points stay on top.
  const order = new Map(points.map((p, i) => [p.id, i]));
  singles.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  return { singles, clusters };
}

/** The bounding box of a cluster's members, for zooming to it. */
export function bounds<T>(members: Placed<T>[]): [[number, number], [number, number]] {
  const xs = members.map((m) => m.x);
  const ys = members.map((m) => m.y);
  return [
    [Math.min(...xs), Math.min(...ys)],
    [Math.max(...xs), Math.max(...ys)],
  ];
}
