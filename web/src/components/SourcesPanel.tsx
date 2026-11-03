import { useEffect, useRef, useState } from 'react';
import { api } from '../apiClient.ts';
import { formatDate, relativeTime } from '../lib/format.ts';
import { useFetch } from '../lib/useFetch.ts';
import { RunHistory } from './RunHistory.tsx';
import { BEST_EFFORT_SOURCES, sourceAlerts } from '../../../shared/health.ts';

export function SourcesPanel({ onClose }: { onClose: () => void }) {
  const [tick, setTick] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const { data, error } = useFetch((s) => api.sources(s), String(tick));
  const dialogRef = useRef<HTMLDivElement>(null);
  const alerts = new Map(sourceAlerts(data?.sources ?? []).map((a) => [a.sourceId, a]));
  // Flagged sources first, so they are visible without scrolling.
  const sources = [...(data?.sources ?? [])].sort((a, b) => Number(alerts.has(b.id)) - Number(alerts.has(a.id)));

  // Follow a running refresh: re-read the status every 2 seconds until it finishes.
  useEffect(() => {
    if (!data?.ingest.running) return;
    const t = setTimeout(() => setTick((n) => n + 1), 2_000);
    return () => clearTimeout(t);
  }, [data]);

  // Modal behaviour: focus moves in, Tab stays inside, Escape closes, focus returns to the opener.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>('button')?.focus();
    return () => opener?.focus();
  }, []);
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab' || !dialogRef.current) return;
    const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')];
    const first = focusable[0];
    const last = focusable.at(-1);
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first?.focus();
    }
  };

  const refresh = async () => {
    try {
      await api.startIngest();
      setMsg('Refresh started. Sources update one by one; NVD can take a minute or two.');
    } catch (e) {
      setMsg((e as Error).message);
    }
    setTimeout(() => setTick((t) => t + 1), 1500);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div ref={dialogRef} className="modal" role="dialog" aria-modal="true" aria-label="Data sources" onClick={(e) => e.stopPropagation()} onKeyDown={onKeyDown}>
        <div className="inv-bar">
          <h3>Data sources</h3>
          <button className="ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {error && <div className="error">{error.message}</div>}
        {alerts.size > 0 && (
          <p className="health-summary small">
            ⚠ {alerts.size} {alerts.size === 1 ? 'source needs' : 'sources need'} attention: recent runs failed or returned far fewer records
            than usual. Flagged rows are listed first and highlighted.
          </p>
        )}
        <table className="sources">
          <thead>
            <tr>
              <th>Source</th>
              <th>Last run</th>
              <th>Status</th>
              <th>Records</th>
              <th>Recent runs</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((s) => (
              <tr key={s.id} className={alerts.has(s.id) ? 'flagged' : undefined}>
                <td>
                  <a href={s.homepage} target="_blank" rel="noreferrer noopener">
                    {s.name}
                  </a>
                  <div className="muted small">{s.description}</div>
                  {BEST_EFFORT_SOURCES.has(s.id) && <div className="muted small">Best effort: occasional failures are expected and not flagged.</div>}
                </td>
                <td title={formatDate(s.lastRunAt)}>{s.lastRunAt ? relativeTime(s.lastRunAt) : 'never'}</td>
                <td>
                  {s.lastStatus === 'ok' && <span className="badge tone-low">ok</span>}
                  {s.lastStatus === 'error' && (
                    <span className="badge tone-critical" title={s.lastError ?? ''}>
                      error
                    </span>
                  )}
                  {s.lastError && <div className="muted small">{s.lastError}</div>}
                </td>
                <td>{s.lastCount ?? '—'}</td>
                <td>
                  <RunHistory runs={s.runs ?? []} />
                  {alerts.has(s.id) && <div className="health-alert small">⚠ {alerts.get(s.id)!.reason}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data?.retention && (
          <p className="muted small retention-note">
            Items expire to keep the data current and the page fast: news after {data.retention.article} days, world events after{' '}
            {data.retention.natural_event} days, and new CVEs that are not known to be exploited after {data.retention.vulnerability} days.
            Entries in CISA&apos;s Known Exploited Vulnerabilities catalogue are kept.
          </p>
        )}
        <div className="modal-foot">
          {api.mode === 'static' ? (
            <span className="muted small">
              Static snapshot{data?.generatedAt && ` generated ${formatDate(data.generatedAt)} (${relativeTime(data.generatedAt)})`}. It is
              rebuilt automatically by a scheduled GitHub Actions workflow.
            </span>
          ) : (
            <>
              <span className="muted small refresh-schedule">
                {data?.ingest.refreshMinutes
                  ? `Automatic refresh every ${data.ingest.refreshMinutes} min${data.ingest.nextRunAt ? `; next ${relativeTime(data.ingest.nextRunAt)}` : ''}.`
                  : 'Automatic refresh is off (set SENTINEL_REFRESH_MINUTES to enable it).'}
                {data?.ingest.running && data.ingest.last && ` Refreshing since ${relativeTime(data.ingest.last.startedAt)}…`}
              </span>
              <button onClick={refresh} disabled={data?.ingest.running}>
                {data?.ingest.running ? 'Refreshing…' : 'Refresh all sources'}
              </button>
              <button className="ghost" onClick={() => setTick((t) => t + 1)}>
                Reload status
              </button>
            </>
          )}
          {msg && <span className="muted small">{msg}</span>}
        </div>
      </div>
    </div>
  );
}
