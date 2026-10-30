import { useEffect, useMemo, useState } from 'react';
import { TIMED_TYPES, type Filters, type SNode, type TimedType } from './api.ts';
import { api } from './apiClient.ts';
import { relativeTime, TYPE_LABEL } from './lib/format.ts';
import { useFetch } from './lib/useFetch.ts';
import { WorldMap } from './components/WorldMap.tsx';
import { Timeline } from './components/Timeline.tsx';
import { Feed } from './components/Feed.tsx';
import { Investigate } from './components/Investigate.tsx';
import { SourcesPanel } from './components/SourcesPanel.tsx';

export const PRESETS = [
  { id: '24h', label: '24h', ms: 86_400_000 },
  { id: '7d', label: '7d', ms: 7 * 86_400_000 },
  { id: '30d', label: '30d', ms: 30 * 86_400_000 },
  { id: '90d', label: '90d', ms: 90 * 86_400_000 },
  { id: '1y', label: '1y', ms: 365 * 86_400_000 },
] as const;
type PresetId = (typeof PRESETS)[number]['id'];

const nodeFromHash = () => {
  const m = /^#\/node\/(.+)$/.exec(window.location.hash);
  return m ? decodeURIComponent(m[1]!) : null;
};

export function App({ now = () => new Date() }: { now?: () => Date }) {
  const [preset, setPreset] = useState<PresetId>('7d');
  const [brush, setBrush] = useState<{ from: string; to: string } | null>(null);
  const [types, setTypes] = useState<TimedType[]>([...TIMED_TYPES]);
  const [query, setQuery] = useState('');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<string | null>(nodeFromHash);
  const [history, setHistory] = useState<string[]>([]);
  const [showSources, setShowSources] = useState(false);
  const [showCountries, setShowCountries] = useState(true);
  // Recomputed when the preset changes, so the window slides forward on re-selection.
  const [anchor, setAnchor] = useState(() => now().getTime());

  useEffect(() => {
    const t = setTimeout(() => setQ(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    const onHash = () => setSelected(nodeFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const windowRange = useMemo(() => {
    const ms = PRESETS.find((p) => p.id === preset)!.ms;
    const to = new Date(anchor);
    // Round to the minute so cache keys stay stable.
    to.setSeconds(0, 0);
    return { from: new Date(to.getTime() - ms).toISOString(), to: new Date(to.getTime() + 60_000).toISOString() };
  }, [preset, anchor]);

  const filters: Filters = { ...(brush ?? windowRange), types, q: q || undefined };
  const fkey = JSON.stringify(filters);

  const map = useFetch((s) => api.map(filters, s), fkey);
  const timeline = useFetch(
    (s) => api.timeline({ ...windowRange, types, q: undefined }, 72, s),
    JSON.stringify([windowRange, types]),
  );

  const [pages, setPages] = useState<{ key: string; items: SNode[]; cursor: string | null }>({ key: '', items: [], cursor: null });
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const feed = useFetch((s) => api.feed(filters, cursor, s), `${fkey}|${cursor ?? ''}`);
  useEffect(() => setCursor(undefined), [fkey]);
  useEffect(() => {
    if (!feed.data) return;
    setPages((prev) => {
      const items = cursor && prev.key === fkey ? [...prev.items, ...feed.data!.items] : feed.data!.items;
      return { key: fkey, items, cursor: feed.data!.nextCursor };
    });
    // Only react to new data; cursor and key are read as of that response.
  }, [feed.data]);

  const select = (id: string) => {
    if (selected && selected !== id) setHistory((h) => [...h, selected]);
    setSelected(id);
    window.history.replaceState(null, '', `#/node/${encodeURIComponent(id)}`);
  };
  const close = () => {
    setSelected(null);
    setHistory([]);
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  };
  const back = () => {
    const prev = history.at(-1);
    if (!prev) return;
    setHistory((h) => h.slice(0, -1));
    setSelected(prev);
    window.history.replaceState(null, '', `#/node/${encodeURIComponent(prev)}`);
  };

  const toggleType = (t: TimedType) =>
    setTypes((cur) => (cur.includes(t) ? (cur.length > 1 ? cur.filter((x) => x !== t) : cur) : [...cur, t]));

  const snapshot = useFetch((s) => api.sources(s), api.mode === 'static' ? 'snapshot' : null);

  const counts = map.data ? { points: map.data.points.length, countries: map.data.countries.reduce((s, c) => s + c.count, 0) } : null;

  return (
    <div className={`app${selected ? ' has-inv' : ''}`}>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            ◉
          </span>
          SENTINEL
          <span className="brand-sub">intelligence explorer</span>
        </div>
        <input
          className="search"
          type="search"
          placeholder="Search titles, CVE IDs, descriptions…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search"
        />
        <div className="seg" role="group" aria-label="Time window">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              className={preset === p.id && !brush ? 'on' : ''}
              onClick={() => {
                setPreset(p.id);
                setBrush(null);
                setAnchor(now().getTime());
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="toggles" role="group" aria-label="Categories">
          {TIMED_TYPES.map((t) => (
            <button key={t} className={`toggle toggle-${t}${types.includes(t) ? ' on' : ''}`} aria-pressed={types.includes(t)} onClick={() => toggleType(t)}>
              <i /> {TYPE_LABEL[t]}
            </button>
          ))}
        </div>
        <button className="ghost" onClick={() => setShowSources(true)}>
          Sources
          {snapshot.data?.generatedAt && (
            <span className="snapshot-tag" title={`Static snapshot generated ${snapshot.data.generatedAt}`}>
              snapshot · {relativeTime(snapshot.data.generatedAt)}
            </span>
          )}
        </button>
      </header>

      <main className="main">
        <section className="stage">
          <div className="stage-head">
            <h2>World view</h2>
            <span className="muted small">
              {brush ? `${new Date(brush.from).toLocaleString()} → ${new Date(brush.to).toLocaleString()}` : `Last ${preset}`}
              {counts && ` · ${counts.points} mapped events · ${counts.countries} articles with publisher country`}
            </span>
            <label className="small check">
              <input type="checkbox" checked={showCountries} onChange={(e) => setShowCountries(e.target.checked)} /> Publisher-country shading
            </label>
          </div>
          <WorldMap
            points={map.data?.points ?? []}
            countryCounts={map.data?.countries ?? []}
            selectedId={selected}
            onSelect={select}
            showCountries={showCountries}
          />
          {timeline.data && (
            <Timeline
              from={timeline.data.from}
              to={timeline.data.to}
              bucketMs={timeline.data.bucketMs}
              series={timeline.data.series}
              selection={brush}
              onBrush={setBrush}
            />
          )}
        </section>

        <section className="side">
          <div className="stage-head">
            <h2>Feed</h2>
            <span className="muted small">{pages.items.length ? `${pages.items.length}${pages.cursor ? '+' : ''} items` : ''}</span>
          </div>
          <Feed
            items={pages.key === fkey ? pages.items : []}
            loading={feed.loading}
            error={feed.error}
            hasMore={pages.key === fkey && Boolean(pages.cursor)}
            selectedId={selected}
            onSelect={select}
            onMore={() => pages.cursor && setCursor(pages.cursor)}
          />
        </section>

        {selected && <Investigate key={selected} id={selected} onSelect={select} onClose={close} onBack={history.length ? back : undefined} />}
      </main>

      {showSources && <SourcesPanel onClose={() => setShowSources(false)} />}
    </div>
  );
}
