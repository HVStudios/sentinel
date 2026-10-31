import { useEffect, useMemo, useRef, useState } from 'react';
import { geoEqualEarth, geoGraticule10, geoPath } from 'd3-geo';
import { select } from 'd3-selection';
import { zoom, zoomIdentity, type ZoomTransform } from 'd3-zoom';
import { feature, mesh } from 'topojson-client';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import type { GeometryCollection, Topology } from 'topojson-specification';
import world from 'world-atlas/countries-110m.json';
import type { SNode, VendorHq } from '../api.ts';
import { createCountryResolver } from '../lib/countries.ts';
import { categoryLabel, relativeTime } from '../lib/format.ts';

const W = 960;
const H = 500;

type CountryFeature = Feature<Geometry, { name: string }>;
const topo = world as unknown as Topology<{ countries: GeometryCollection<{ name: string }> }>;
const countries = (feature(topo, topo.objects.countries) as FeatureCollection<Geometry, { name: string }>).features as CountryFeature[];
const borders = mesh(topo, topo.objects.countries, (a, b) => a !== b);
const resolveCountry = createCountryResolver(countries.map((c) => c.properties.name));

const projection = geoEqualEarth().fitExtent(
  [
    [8, 8],
    [W - 8, H - 8],
  ],
  { type: 'Sphere' },
);
const path = geoPath(projection);
const spherePath = path({ type: 'Sphere' }) ?? '';
const graticulePath = path(geoGraticule10()) ?? '';
const countryPaths = countries.map((c) => ({ name: c.properties.name, d: path(c) ?? '' }));
const borderPath = path(borders) ?? '';

export const POINT_COLORS: Record<string, string> = {
  earthquake: 'var(--c-quake)',
  wildfires: 'var(--c-fire)',
  severeStorms: 'var(--c-storm)',
  volcanoes: 'var(--c-volcano)',
};

interface Props {
  points: SNode[];
  countryCounts: { country: string; count: number }[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  showCountries: boolean;
  /** Vendor headquarters (Wikidata) for vulnerabilities in the window. */
  vendors?: VendorHq[];
  showVendors?: boolean;
}

export function WorldMap({ points, countryCounts, selectedId, onSelect, showCountries, vendors = [], showVendors = false }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [transform, setTransform] = useState<ZoomTransform>(zoomIdentity);
  const [hover, setHover] = useState<{ node: SNode; x: number; y: number } | null>(null);
  const [hoverVendor, setHoverVendor] = useState<{ v: VendorHq; x: number; y: number } | null>(null);
  const maxVulns = Math.max(1, ...vendors.map((v) => v.vulnerabilities));

  useEffect(() => {
    if (!svgRef.current) return;
    const svg = select(svgRef.current);
    const z = zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, 12])
      .translateExtent([
        [0, 0],
        [W, H],
      ])
      .on('zoom', (e: { transform: ZoomTransform }) => setTransform(e.transform));
    svg.call(z);
    return () => {
      svg.on('.zoom', null);
    };
  }, []);

  const { shading, unmapped, max } = useMemo(() => {
    const shading = new Map<string, number>();
    const unmapped: { country: string; count: number }[] = [];
    for (const c of countryCounts) {
      const name = resolveCountry(c.country);
      if (name) shading.set(name, (shading.get(name) ?? 0) + c.count);
      else unmapped.push(c);
    }
    return { shading, unmapped, max: Math.max(1, ...shading.values()) };
  }, [countryCounts]);

  const projected = useMemo(
    () =>
      points
        .map((p) => ({ p, xy: projection([p.lon!, p.lat!]) }))
        .filter((x): x is { p: SNode; xy: [number, number] } => x.xy !== null)
        // Draw low-severity first so significant events stay on top.
        .sort((a, b) => (a.p.severity ?? 0) - (b.p.severity ?? 0)),
    [points],
  );

  const k = transform.k;

  return (
    <div className="map-wrap">
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="world-map" role="img" aria-label="World map of geolocated events">
        <defs>
          <radialGradient id="glow">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
        </defs>
        <g transform={transform.toString()}>
          <path d={spherePath} className="sphere" />
          <path d={graticulePath} className="graticule" strokeWidth={0.5 / k} />
          {countryPaths.map((c) => {
            const count = showCountries ? shading.get(c.name) : undefined;
            return (
              <path
                key={c.name}
                d={c.d}
                className="country"
                data-country={c.name}
                style={count ? { fill: `color-mix(in oklab, var(--c-news) ${Math.round(18 + 62 * Math.sqrt(count / max))}%, var(--land))` } : undefined}
              >
                <title>{count ? `${c.name}: ${count} article${count === 1 ? '' : 's'} by publishers based here` : c.name}</title>
              </path>
            );
          })}
          <path d={borderPath} className="borders" strokeWidth={0.5 / k} />
          {projected.map(({ p, xy }) => {
            const r = (2.5 + 7 * (p.severity ?? 0.3)) / Math.sqrt(k);
            const selected = p.id === selectedId;
            return (
              <g
                key={p.id}
                transform={`translate(${xy[0]},${xy[1]})`}
                className={`point${selected ? ' selected' : ''}`}
                data-id={p.id}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(p.id);
                }}
                onMouseEnter={(e) => setHover({ node: p, x: e.clientX, y: e.clientY })}
                onMouseLeave={() => setHover(null)}
                tabIndex={0}
                role="button"
                aria-label={p.title}
                onKeyDown={(e) => e.key === 'Enter' && onSelect(p.id)}
              >
                {(p.severity ?? 0) > 0.55 && <circle r={r * 2.4} className="pulse" style={{ fill: POINT_COLORS[p.category ?? ''] ?? 'var(--c-event)' }} />}
                <circle r={r} style={{ fill: POINT_COLORS[p.category ?? ''] ?? 'var(--c-event)' }} strokeWidth={(selected ? 2 : 0.8) / Math.sqrt(k)} />
              </g>
            );
          })}
          {showVendors &&
            vendors.map((v) => {
              const xy = projection([v.lon, v.lat]);
              if (!xy) return null;
              const r = (3 + 6 * Math.sqrt(v.vulnerabilities / maxVulns)) / Math.sqrt(k);
              return (
                <g
                  key={v.id}
                  transform={`translate(${xy[0]},${xy[1]}) rotate(45)`}
                  className={`vendor-hq${v.id === selectedId ? ' selected' : ''}`}
                  data-vendor={v.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect(v.id);
                  }}
                  onMouseEnter={(e) => setHoverVendor({ v, x: e.clientX, y: e.clientY })}
                  onMouseLeave={() => setHoverVendor(null)}
                  tabIndex={0}
                  role="button"
                  aria-label={`${v.title} headquarters, ${v.hq}: ${v.vulnerabilities} vulnerabilities in this window`}
                  onKeyDown={(e) => e.key === 'Enter' && onSelect(v.id)}
                >
                  <rect x={-r} y={-r} width={2 * r} height={2 * r} strokeWidth={1 / Math.sqrt(k)} />
                </g>
              );
            })}
        </g>
      </svg>

      <div className="map-legend">
        <div className="legend-row">
          {Object.entries(POINT_COLORS).map(([cat, color]) => (
            <span key={cat} className="legend-item">
              <i style={{ background: color }} /> {categoryLabel(cat)}
            </span>
          ))}
          <span className="legend-item">
            <i style={{ background: 'var(--c-event)' }} /> Other events
          </span>
        </div>
        <div className="legend-note">Points: coordinates as reported by USGS / NASA EONET. Size = severity.</div>
        {showCountries && (
          <div className="legend-note">
            <i className="swatch-news" /> Shading: news volume by <strong>publisher country</strong> (curated feeds and GDELT), not where events happened.
            {unmapped.length > 0 && (
              <span className="unmapped" title="These countries are too small for the 1:110m base map and are not drawn rather than guessed.">
                {' '}
                Not drawn: {unmapped.map((u) => `${u.country} (${u.count})`).join(', ')}
              </span>
            )}
          </div>
        )}
        {showVendors ? (
          <div className="legend-note">
            <i className="swatch-vendor" /> Diamonds: <strong>vendor headquarters</strong> (Wikidata) for vulnerabilities in this window, sized by
            count. They show where the vendor is based, not where vulnerabilities are exploited.
          </div>
        ) : (
          <div className="legend-note muted">Vulnerabilities are not mapped: KEV and NVD do not report locations.</div>
        )}
      </div>

      {transform.k > 1 && (
        <button
          className="map-reset"
          onClick={() => svgRef.current && select(svgRef.current).call(zoom<SVGSVGElement, unknown>().transform, zoomIdentity)}
        >
          Reset view
        </button>
      )}

      {hoverVendor && (
        <div className="map-tooltip" style={{ left: hoverVendor.x + 12, top: hoverVendor.y + 12 }} role="tooltip">
          <div className="tt-cat tt-vendor">Vendor headquarters · Wikidata</div>
          <div className="tt-title">{hoverVendor.v.title}</div>
          <div className="tt-meta">
            {hoverVendor.v.hq}
            {hoverVendor.v.country ? `, ${hoverVendor.v.country}` : ''} · {hoverVendor.v.vulnerabilities} vulnerabilit
            {hoverVendor.v.vulnerabilities === 1 ? 'y' : 'ies'} in window
          </div>
        </div>
      )}

      {hover && (
        <div className="map-tooltip" style={{ left: hover.x + 12, top: hover.y + 12 }} role="tooltip">
          <div className="tt-cat">{categoryLabel(hover.node.category)}</div>
          <div className="tt-title">{hover.node.title}</div>
          <div className="tt-meta">{relativeTime(hover.node.occurredAt)}</div>
        </div>
      )}
    </div>
  );
}
