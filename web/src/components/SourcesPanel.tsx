import { useEffect, useRef, useState } from 'react';
import { api } from '../apiClient.ts';
import { formatDate, relativeTime } from '../lib/format.ts';
import { useFetch } from '../lib/useFetch.ts';

export function SourcesPanel({ onClose }: { onClose: () => void }) {
  const [tick, setTick] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const { data, error } = useFetch((s) => api.sources(s), String(tick));
  const dialogRef = useRef<HTMLDivElement>(null);

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
        <table className="sources">
          <thead>
            <tr>
              <th>Source</th>
              <th>Last run</th>
              <th>Status</th>
              <th>Records</th>
            </tr>
          </thead>
          <tbody>
            {data?.sources.map((s) => (
              <tr key={s.id}>
                <td>
                  <a href={s.homepage} target="_blank" rel="noreferrer noopener">
                    {s.name}
                  </a>
                  <div className="muted small">{s.description}</div>
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
              </tr>
            ))}
          </tbody>
        </table>
        <div className="modal-foot">
          {api.mode === 'static' ? (
            <span className="muted small">
              Static snapshot{data?.generatedAt && ` generated ${formatDate(data.generatedAt)} (${relativeTime(data.generatedAt)})`}. It is
              rebuilt automatically by a scheduled GitHub Actions workflow.
            </span>
          ) : (
            <>
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
