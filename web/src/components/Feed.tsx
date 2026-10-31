import type { SNode } from '../api.ts';
import { badgesFor, categoryLabel, relativeTime, sourceDomain, TYPE_LABEL } from '../lib/format.ts';

interface Props {
  items: SNode[];
  loading: boolean;
  error?: Error;
  hasMore: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onMore: () => void;
}

export function Feed({ items, loading, error, hasMore, selectedId, onSelect, onMore }: Props) {
  return (
    <section className="feed" aria-label="Event feed">
      {error && <div className="error">Could not load the feed: {error.message}</div>}
      {!loading && !error && items.length === 0 && (
        <div className="empty">
          Nothing in this window. Widen the time range, enable more categories, or run <code>npm run ingest</code>.
        </div>
      )}
      <ol className="feed-list">
        {items.map((n) => (
          <li key={n.id}>
            <button className={`feed-item type-${n.type}${n.id === selectedId ? ' selected' : ''}`} onClick={() => onSelect(n.id)}>
              <div className="feed-meta">
                <span className={`pill pill-${n.type}`}>{categoryLabel(n.category) || TYPE_LABEL[n.type]}</span>
                <time dateTime={n.occurredAt ?? undefined} title={n.occurredAt ?? undefined}>
                  {relativeTime(n.occurredAt)}
                </time>
              </div>
              <div className="feed-title">{n.title}</div>
              <div className="feed-foot">
                {badgesFor(n).map((b) => (
                  <span key={b.label} className={`badge tone-${b.tone}`} title={b.title}>
                    {b.label}
                  </span>
                ))}
                {n.type === 'vulnerability' && <span className="feed-id">{n.attrs.cveId}</span>}
                {n.type !== 'vulnerability' && sourceDomain(n) && <span className="feed-id">{sourceDomain(n)}</span>}
                {n.attrs.story && (
                  <span className="story-chip" title={`Part of the story “${n.attrs.story.title}” (${n.attrs.story.size} related items)`}>
                    Story · {n.attrs.story.size}
                  </span>
                )}
                {n.geoBasis === 'publisher_country' && n.country && (
                  <span className="feed-id" title="Country of the publishing outlet, not of the event">
                    publisher: {n.country}
                  </span>
                )}
              </div>
            </button>
          </li>
        ))}
      </ol>
      {loading && <div className="loading">Loading…</div>}
      {hasMore && !loading && (
        <button className="more" onClick={onMore}>
          Load more
        </button>
      )}
    </section>
  );
}
