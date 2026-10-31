import { relativeTime, TYPE_LABEL } from '../lib/format.ts';
import type { WatchStatus } from '../lib/watchlist.ts';

interface Props {
  statuses: WatchStatus[];
  totalNew: number;
  onSelect: (id: string) => void;
  onMarkSeen: (id?: string) => void;
  onRemove: (id: string) => void;
}

const SHOWN = 8;

export function WatchlistView({ statuses, totalNew, onSelect, onMarkSeen, onRemove }: Props) {
  return (
    <section className="feed" aria-label="Watchlist items">
      <div className="watch-intro">
        <p className="muted small">
          Watch a vendor, product, vulnerability or story with ★ in its investigation panel. New related items are counted here. Your
          watchlist is stored only in this browser.
        </p>
        {totalNew > 0 && (
          <button className="ghost small" onClick={() => onMarkSeen()}>
            Mark all as seen
          </button>
        )}
      </div>
      {statuses.length === 0 && <div className="empty">Nothing watched yet.</div>}
      <ul className="watch-list">
        {statuses.map(({ watch, items, isNew, newCount, error }) => (
          <li key={watch.id} className="watch">
            <div className="watch-head">
              <span className={`pill pill-${watch.type}`}>{TYPE_LABEL[watch.type]}</span>
              <button className="link-btn watch-title" onClick={() => onSelect(watch.id)}>
                {watch.title}
              </button>
              {newCount > 0 && <span className="badge tone-high">{newCount} new</span>}
            </div>
            {error ? (
              <div className="muted small">{error.startsWith('404') ? 'No longer in the data.' : `Could not load: ${error}`}</div>
            ) : items.length === 0 ? (
              <div className="muted small">No related items yet.</div>
            ) : (
              <ol className="watch-items">
                {items.slice(0, SHOWN).map((item) => (
                  <li key={item.id}>
                    {isNew(item) && <span className="new-tag">New</span>}
                    <button className="link-btn" onClick={() => onSelect(item.id)}>
                      {item.title}
                    </button>
                    <div className="muted small">
                      {item.via} · {relativeTime(item.occurredAt)}
                    </div>
                  </li>
                ))}
                {items.length > SHOWN && <li className="muted small">…and {items.length - SHOWN} more</li>}
              </ol>
            )}
            <div className="watch-actions">
              {newCount > 0 && (
                <button className="ghost small" onClick={() => onMarkSeen(watch.id)}>
                  Mark as seen
                </button>
              )}
              <button className="ghost small" onClick={() => onRemove(watch.id)} aria-label={`Remove ${watch.title} from watchlist`}>
                Remove
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
