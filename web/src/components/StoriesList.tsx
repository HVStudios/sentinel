import type { SNode } from '../api.ts';
import { relativeTime } from '../lib/format.ts';

interface Props {
  stories: SNode[];
  loading: boolean;
  error?: Error;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

export function StoriesList({ stories, loading, error, selectedId, onSelect }: Props) {
  return (
    <section className="feed" aria-label="Story list">
      <p className="stories-note muted small">
        Groups of related items, linked by shared identifiers, exploit chains, the same exploited product, or near-identical headlines.
        Built by SENTINEL from those explicit links, not by an AI model.
      </p>
      {error && <div className="error">Could not load stories: {error.message}</div>}
      {!loading && !error && stories.length === 0 && <div className="empty">No stories in this window.</div>}
      <ol className="feed-list">
        {stories.map((s) => {
          const a = s.attrs ?? {};
          const anchors: string[] = a.anchors ?? [];
          const outlets: string[] = a.outlets ?? [];
          return (
            <li key={s.id}>
              <button className={`feed-item type-story${s.id === selectedId ? ' selected' : ''}`} onClick={() => onSelect(s.id)}>
                <div className="feed-meta">
                  <span className="pill pill-story">Story · {a.size} items</span>
                  <time dateTime={s.occurredAt ?? undefined} title={`Last update ${s.occurredAt}`}>
                    {relativeTime(s.occurredAt)}
                  </time>
                </div>
                <div className="feed-title">{s.title}</div>
                <div className="feed-foot">
                  {anchors.slice(0, 3).map((x) => (
                    <span key={x} className="badge tone-info">
                      {x}
                    </span>
                  ))}
                  {anchors.length > 3 && <span className="feed-id">+{anchors.length - 3}</span>}
                  <span className="feed-id" title={outlets.join(', ')}>
                    {outlets.length} source{outlets.length === 1 ? '' : 's'} · {day(a.firstSeen)}
                    {day(a.firstSeen) !== day(a.lastSeen) ? ` → ${day(a.lastSeen)}` : ''}
                  </span>
                </div>
              </button>
            </li>
          );
        })}
      </ol>
      {loading && <div className="loading">Loading…</div>}
    </section>
  );
}
