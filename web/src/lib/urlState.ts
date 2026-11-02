import { TIMED_TYPES, type FeedSort, type TimedType } from '../api.ts';

/**
 * The view, as a shareable URL hash: `#/node/<id>?w=30d&t=vulnerability,article&q=…`.
 * Hash routing works on GitHub Pages without server rewrites. Defaults are omitted, so plain
 * links stay short and older `#/node/<id>` links keep working.
 * Presets are relative (a "7d" link shows the last 7 days when opened); a brushed range is absolute.
 */
export const PRESET_IDS = ['24h', '7d', '30d', '90d', '1y'] as const;
export type PresetId = (typeof PRESET_IDS)[number];
export type SideView = 'feed' | 'stories' | 'watchlist';
export type StageView = 'map' | 'trends';
export const LAYERS = ['publishers', 'vendors', 'gdacs'] as const;
export type Layer = (typeof LAYERS)[number];

export interface ViewState {
  node: string | null;
  preset: PresetId;
  brush: { from: string; to: string } | null;
  types: TimedType[];
  q: string;
  sort: FeedSort;
  view: SideView;
  main: StageView;
  /** Map layers switched off (all are on by default). */
  hidden: Layer[];
}

export const DEFAULT_VIEW: ViewState = {
  node: null,
  preset: '7d',
  brush: null,
  types: [...TIMED_TYPES],
  q: '',
  sort: 'mixed',
  view: 'feed',
  main: 'map',
  hidden: [],
};

const SORTS: FeedSort[] = ['mixed', 'latest', 'top'];
const VIEWS: SideView[] = ['feed', 'stories', 'watchlist'];
const isIso = (s: string | null): s is string => !!s && !Number.isNaN(Date.parse(s));
const pick = <T extends string>(v: string | null, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);

/** Unknown or malformed values fall back to defaults; a shared link never breaks the page. */
export function parseHash(hash: string): ViewState {
  const raw = hash.replace(/^#/, '');
  const [path = '', query = ''] = raw.split(/\?(.*)/s);
  const p = new URLSearchParams(query);
  const nodeMatch = /^\/node\/(.+)$/.exec(path);
  let node: string | null = null;
  if (nodeMatch) {
    try {
      node = decodeURIComponent(nodeMatch[1]!);
    } catch {
      node = null;
    }
  }
  const types = (p.get('t') ?? '').split(',').filter((t): t is TimedType => (TIMED_TYPES as string[]).includes(t));
  const from = p.get('from');
  const to = p.get('to');
  return {
    node,
    preset: pick(p.get('w'), PRESET_IDS, DEFAULT_VIEW.preset),
    brush: isIso(from) && isIso(to) && from < to ? { from: new Date(from).toISOString(), to: new Date(to).toISOString() } : null,
    types: types.length ? [...new Set(types)] : [...DEFAULT_VIEW.types],
    q: (p.get('q') ?? '').slice(0, 200),
    sort: pick(p.get('sort'), SORTS, DEFAULT_VIEW.sort),
    view: pick(p.get('view'), VIEWS, DEFAULT_VIEW.view),
    main: p.get('main') === 'trends' ? 'trends' : 'map',
    hidden: (p.get('off') ?? '').split(',').filter((l): l is Layer => (LAYERS as readonly string[]).includes(l)),
  };
}

export function formatHash(s: ViewState): string {
  const p = new URLSearchParams();
  if (s.preset !== DEFAULT_VIEW.preset) p.set('w', s.preset);
  if (s.brush) {
    p.set('from', s.brush.from);
    p.set('to', s.brush.to);
  }
  const allTypes = s.types.length === TIMED_TYPES.length && TIMED_TYPES.every((t) => s.types.includes(t));
  if (!allTypes) p.set('t', TIMED_TYPES.filter((t) => s.types.includes(t)).join(','));
  if (s.q) p.set('q', s.q);
  if (s.sort !== DEFAULT_VIEW.sort) p.set('sort', s.sort);
  if (s.view !== DEFAULT_VIEW.view) p.set('view', s.view);
  if (s.main !== DEFAULT_VIEW.main) p.set('main', s.main);
  if (s.hidden.length) p.set('off', LAYERS.filter((l) => s.hidden.includes(l)).join(','));
  const query = p.toString().replace(/%2C/g, ',');
  return `#/${s.node ? `node/${encodeURIComponent(s.node)}` : ''}${query ? `?${query}` : ''}`;
}

/**
 * Whether going from one view to another deserves its own history entry (so Back undoes it).
 * Typing a search only replaces the current entry, instead of adding one per keystroke.
 */
export function isNavigation(prev: ViewState, next: ViewState): boolean {
  const { q: _a, ...a } = prev;
  const { q: _b, ...b } = next;
  return JSON.stringify(a) !== JSON.stringify(b);
}
