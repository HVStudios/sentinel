import { useEffect, useMemo, useRef, useState } from 'react';
import { TIMED_TYPES, type FeedSort, type Filters, type SNode, type TimedType } from './api.ts';
import { api } from './apiClient.ts';
import { relativeTime, TYPE_LABEL } from './lib/format.ts';
import { useFetch } from './lib/useFetch.ts';
import { WorldMap } from './components/WorldMap.tsx';
import { Timeline } from './components/Timeline.tsx';
import { Feed } from './components/Feed.tsx';
import { Investigate } from './components/Investigate.tsx';
import { SourcesPanel } from './components/SourcesPanel.tsx';
import { sourceAlerts } from '../../shared/health.ts';
import { StoriesList } from './components/StoriesList.tsx';
import { WatchlistView } from './components/WatchlistView.tsx';
import { TrendsView } from './components/TrendsView.tsx';
import { useWatchData, useWatchlist } from './lib/watchlist.ts';
import { useDataVersion } from './lib/useDataVersion.ts';
import { formatHash, isNavigation, parseHash, type ViewState } from './lib/urlState.ts';
import { BrandMark, Icon } from './components/Icon.tsx';

export const PRESETS = [
  { id: '24h', label: '24h', ms: 86_400_000 },
  { id: '7d', label: '7d', ms: 7 * 86_400_000 },
  { id: '30d', label: '30d', ms: 30 * 86_400_000 },
  { id: '90d', label: '90d', ms: 90 * 86_400_000 },
  { id: '1y', label: '1y', ms: 365 * 86_400_000 },
] as const;
type PresetId = (typeof PRESETS)[number]['id'];

export const FEED_SORTS: { id: FeedSort; label: string; title: string }[] = [
  { id: 'mixed', label: 'Mixed', title: 'Newest first, taking from each category in turn so no single category crowds out the others' },
  { id: 'latest', label: 'Latest', title: 'Strictly newest first across all categories' },
  { id: 'top', label: 'Top', title: 'Highest severity or SENTINEL rank first, taking from each category in turn' },
];

const sourceName = (sources: { id: string; name: string }[], id: string) => sources.find((s) => s.id === id)?.name ?? id;

export function App({ now = () => new Date() }: { now?: () => Date }) {
  // The whole view lives in the URL hash, so links reproduce it and Back undoes filter changes.
  const [initial] = useState<ViewState>(() => parseHash(window.location.hash));
  const [preset, setPreset] = useState<PresetId>(initial.preset);
  const [brush, setBrush] = useState<{ from: string; to: string } | null>(initial.brush);
  const [types, setTypes] = useState<TimedType[]>(initial.types);
  const [query, setQuery] = useState(initial.q);
  const [q, setQ] = useState(initial.q);
  const [selected, setSelected] = useState<string | null>(initial.node);
  const [history, setHistory] = useState<string[]>([]);
  const [showSources, setShowSources] = useState(false);
  const [showCountries, setShowCountries] = useState(!initial.hidden.includes('publishers'));
  const [sort, setSort] = useState<FeedSort>(initial.sort);
  const [showVendors, setShowVendors] = useState(!initial.hidden.includes('vendors'));
  const [showAffected, setShowAffected] = useState(!initial.hidden.includes('gdacs'));
  // Publisher countries of a vulnerability's coverage, outlined while that item stays open.
  const [coverage, setCoverage] = useState<{ id: string; title: string; countries: string[] } | null>(null);
  const [view, setView] = useState<'feed' | 'stories' | 'watchlist'>(initial.view);
  const [stageView, setStageView] = useState<'map' | 'trends'>(initial.main);
  const [copyStatus, setCopyStatus] = useState('');
  // Live mode: reload data whenever a server-side refresh (manual or scheduled) finishes.
  const data = useDataVersion(api);
  const watchlist = useWatchlist(now);
  const watchData = useWatchData(watchlist.watches, data.version);
  // Recomputed when the preset changes, so the window slides forward on re-selection.
  const [anchor, setAnchor] = useState(() => now().getTime());

  useEffect(() => {
    const t = setTimeout(() => setQ(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  const viewState: ViewState = useMemo(
    () => ({
      node: selected,
      preset,
      brush,
      types,
      q,
      sort,
      view,
      main: stageView,
      hidden: [...(showCountries ? [] : ['publishers' as const]), ...(showVendors ? [] : ['vendors' as const]), ...(showAffected ? [] : ['gdacs' as const])],
    }),
    [selected, preset, brush, types, q, sort, view, stageView, showCountries, showVendors, showAffected],
  );

  // State → URL: navigation gets its own history entry; typing a search only replaces the current one.
  const lastView = useRef<ViewState>(initial);
  useEffect(() => {
    const hash = formatHash(viewState);
    if (hash !== window.location.hash) {
      const push = isNavigation(lastView.current, viewState) && window.location.hash !== '';
      window.history[push ? 'pushState' : 'replaceState'](null, '', hash);
    }
    lastView.current = viewState;
  }, [viewState]);

  // URL → state: Back/Forward and edited or pasted links.
  useEffect(() => {
    const apply = () => {
      const v = parseHash(window.location.hash);
      lastView.current = v;
      setSelected(v.node);
      setHistory([]);
      setPreset(v.preset);
      setBrush(v.brush);
      setTypes(v.types);
      setQuery(v.q);
      setQ(v.q);
      setSort(v.sort);
      setView(v.view);
      setStageView(v.main);
      setShowCountries(!v.hidden.includes('publishers'));
      setShowVendors(!v.hidden.includes('vendors'));
      setShowAffected(!v.hidden.includes('gdacs'));
    };
    window.addEventListener('popstate', apply);
    window.addEventListener('hashchange', apply);
    return () => {
      window.removeEventListener('popstate', apply);
      window.removeEventListener('hashchange', apply);
    };
  }, []);

  const windowRange = useMemo(() => {
    const ms = PRESETS.find((p) => p.id === preset)!.ms;
    const to = new Date(anchor);
    // Round to the minute so cache keys stay stable.
    to.setSeconds(0, 0);
    return { from: new Date(to.getTime() - ms).toISOString(), to: new Date(to.getTime() + 60_000).toISOString() };
  }, [preset, anchor]);

  const filters: Filters = { ...(brush ?? windowRange), types, q: q || undefined };
  const fkey = JSON.stringify([filters, data.version]);

  const map = useFetch((s) => api.map(filters, s), fkey);
  const timeline = useFetch(
    (s) => api.timeline({ ...windowRange, types, q: undefined }, 72, s),
    JSON.stringify([windowRange, types, data.version]),
  );

  const [pages, setPages] = useState<{ key: string; items: SNode[]; cursor: string | null }>({ key: '', items: [], cursor: null });
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  // Sorting only affects the feed, so the map and timeline do not refetch when it changes.
  const feedFilters: Filters = { ...filters, sort };
  const feedKey = JSON.stringify([feedFilters, data.version]);
  const feed = useFetch((s) => api.feed(feedFilters, cursor, s), `${feedKey}|${cursor ?? ''}`);
  useEffect(() => setCursor(undefined), [feedKey]);
  useEffect(() => {
    if (!feed.data) return;
    setPages((prev) => {
      const items = cursor && prev.key === feedKey ? [...prev.items, ...feed.data!.items] : feed.data!.items;
      return { key: feedKey, items, cursor: feed.data!.nextCursor };
    });
    // Only react to new data; cursor and key are read as of that response.
  }, [feed.data]);

  /** Where focus was before the investigation opened, so closing it can put focus back. */
  const returnFocus = useRef<HTMLElement | SVGElement | null>(null);

  const select = (id: string) => {
    // Map and graph markers are SVG elements, so accept those as well as HTML controls.
    const active = document.activeElement;
    if (!selected && (active instanceof HTMLElement || active instanceof SVGElement)) returnFocus.current = active;
    if (selected && selected !== id) setHistory((h) => [...h, selected]);
    setSelected(id);
  };
  const close = () => {
    const target = returnFocus.current;
    returnFocus.current = null;
    // After the panel unmounts, return focus to the trigger if it still exists, otherwise to the feed.
    setTimeout(() => (target?.isConnected ? target : document.getElementById('feed'))?.focus());
    setSelected(null);
    setHistory([]);
  };
  const back = () => {
    const prev = history.at(-1);
    if (!prev) return;
    setHistory((h) => h.slice(0, -1));
    setSelected(prev);
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopyStatus('Link copied');
    } catch {
      setCopyStatus('Could not copy; the address bar has the link');
    }
    setTimeout(() => setCopyStatus(''), 2500);
  };

  const toggleType = (t: TimedType) =>
    setTypes((cur) => (cur.includes(t) ? (cur.length > 1 ? cur.filter((x) => x !== t) : cur) : [...cur, t]));

  const storyWindow = brush ?? windowRange;
  const stories = useFetch((s) => api.stories(storyWindow, s), view === 'stories' ? JSON.stringify([storyWindow, data.version]) : null);

  // Source status for the header: snapshot age (static) and health alerts (both modes).
  const snapshot = useFetch((s) => api.sources(s), `sources:${data.version}`);
  const alerts = snapshot.data ? sourceAlerts(snapshot.data.sources) : [];

  const counts = map.data ? { points: map.data.points.length, countries: map.data.countries.reduce((s, c) => s + c.count, 0) } : null;

  return (
    <div className={`app${selected ? ' has-inv' : ''}`}>
      <a
        className="skip-link"
        href="#feed"
        onClick={(e) => {
          // Hash links are used for routing (#/node/…), so move focus without touching the URL.
          e.preventDefault();
          document.getElementById('feed')?.focus();
        }}
      >
        Skip to feed
      </a>
      <header className="topbar">
        <div className="brand">
          <BrandMark />
          <span className="brand-name">SENTINEL</span>
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
              aria-pressed={preset === p.id && !brush}
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
        <button className="ghost" onClick={copyLink} title="Copy a link to exactly this view">
          Copy link
        </button>
        <span className="copy-status small" role="status" aria-live="polite">
          {copyStatus}
        </span>
        <button className="ghost" onClick={() => setShowSources(true)}>
          Sources
          {data.running && <span className="refreshing-tag">refreshing…</span>}
          {alerts.length > 0 && (
            <span className="alert-tag" title={alerts.map((a) => `${sourceName(snapshot.data!.sources, a.sourceId)}: ${a.reason}`).join('\n')}>
              <Icon name="alert" /> {alerts.length} {alerts.length === 1 ? 'source needs' : 'sources need'} attention
            </span>
          )}
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
            <h2>{stageView === 'map' ? 'World view' : 'Trends'}</h2>
            <div className="seg seg-sm seg-view" role="group" aria-label="Main view">
              <button className={stageView === 'map' ? 'on' : ''} aria-pressed={stageView === 'map'} onClick={() => setStageView('map')}>
                Map
              </button>
              <button className={stageView === 'trends' ? 'on' : ''} aria-pressed={stageView === 'trends'} onClick={() => setStageView('trends')}>
                Trends
              </button>
            </div>
            {stageView === 'map' && (
              <>
                <span className="muted small">
                  {brush ? `${new Date(brush.from).toLocaleString()} → ${new Date(brush.to).toLocaleString()}` : `Last ${preset}`}
                  {counts && ` · ${counts.points} mapped events · ${counts.countries} articles with publisher country`}
                </span>
                <label className="small check">
                  <input type="checkbox" checked={showCountries} onChange={(e) => setShowCountries(e.target.checked)} /> Publisher-country shading
                </label>
                <label className="small check check-tight">
                  <input type="checkbox" checked={showVendors} onChange={(e) => setShowVendors(e.target.checked)} /> Vendor HQs
                </label>
                <label className="small check check-tight">
                  <input type="checkbox" checked={showAffected} onChange={(e) => setShowAffected(e.target.checked)} /> GDACS affected countries
                </label>
              </>
            )}
          </div>
          {stageView === 'trends' ? (
            <TrendsView onSelect={select} dataVersion={data.version} />
          ) : (
            <>
            <WorldMap
              points={map.data?.points ?? []}
              countryCounts={map.data?.countries ?? []}
              selectedId={selected}
              onSelect={select}
              showCountries={showCountries}
              vendors={map.data?.vendors ?? []}
              showVendors={showVendors && types.includes('vulnerability')}
            affected={map.data?.affected ?? []}
            showAffected={showAffected && types.includes('natural_event')}
            coverage={coverage?.id === selected ? coverage : null}
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
            </>
          )}
        </section>

        <section className="side" id="feed" tabIndex={-1} aria-labelledby="feed-heading">
          <div className="stage-head">
            <h2 id="feed-heading">{{ feed: 'Feed', stories: 'Stories', watchlist: 'Watchlist' }[view]}</h2>
            <div className="seg seg-sm seg-view" role="group" aria-label="Side panel view">
              <button className={view === 'feed' ? 'on' : ''} aria-pressed={view === 'feed'} onClick={() => setView('feed')}>
                Feed
              </button>
              <button className={view === 'stories' ? 'on' : ''} aria-pressed={view === 'stories'} onClick={() => setView('stories')}>
                Stories
              </button>
              <button
                className={view === 'watchlist' ? 'on' : ''}
                aria-pressed={view === 'watchlist'}
                onClick={() => setView('watchlist')}
              >
                <Icon name="star" />Watchlist
                {watchData.totalNew > 0 && (
                  <span className="count-badge">
                    {watchData.totalNew}
                    <span className="sr-only"> new</span>
                  </span>
                )}
              </button>
            </div>
            {view === 'feed' && (
              <>
                <span className="muted small">{pages.items.length ? `${pages.items.length}${pages.cursor ? '+' : ''} items` : ''}</span>
                <div className="seg seg-sm" role="group" aria-label="Feed order">
                  {FEED_SORTS.map((o) => (
                    <button key={o.id} className={sort === o.id ? 'on' : ''} title={o.title} aria-pressed={sort === o.id} onClick={() => setSort(o.id)}>
                      {o.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          {view === 'feed' ? (
            <Feed
              items={pages.key === feedKey ? pages.items : []}
              loading={feed.loading}
              error={feed.error}
              hasMore={pages.key === feedKey && Boolean(pages.cursor)}
              selectedId={selected}
              onSelect={select}
              onMore={() => pages.cursor && setCursor(pages.cursor)}
              watchHits={watchData.hits}
            />
          ) : view === 'stories' ? (
            <StoriesList stories={stories.data?.stories ?? []} loading={stories.loading} error={stories.error} selectedId={selected} onSelect={select} />
          ) : (
            <WatchlistView
              statuses={watchData.statuses}
              totalNew={watchData.totalNew}
              onSelect={select}
              onMarkSeen={watchlist.markSeen}
              onRemove={watchlist.remove}
            />
          )}
        </section>

        {selected && (
          <Investigate
            key={selected}
            id={selected}
            onSelect={select}
            onClose={close}
            onBack={history.length ? back : undefined}
            watched={watchlist.isWatched(selected)}
            onToggleWatch={watchlist.toggle}
            coverageShown={coverage?.id === selected}
            onShowCoverage={(c) => {
              setCoverage(c);
              if (c) setStageView('map');
            }}
          />
        )}
      </main>

      {showSources && <SourcesPanel onClose={() => setShowSources(false)} />}
    </div>
  );
}
