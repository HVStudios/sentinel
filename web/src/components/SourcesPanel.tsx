import { useState } from 'react';
import { api } from '../api.ts';
import { formatDate, relativeTime } from '../lib/format.ts';
import { useFetch } from '../lib/useFetch.ts';

export function SourcesPanel({ onClose }: { onClose: () => void }) {
  const [tick, setTick] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const { data, error } = useFetch((s) => api.sources(s), String(tick));

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
      <div className="modal" role="dialog" aria-label="Data sources" onClick={(e) => e.stopPropagation()}>
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
          <button onClick={refresh} disabled={data?.ingest.running}>
            {data?.ingest.running ? 'Refreshing…' : 'Refresh all sources'}
          </button>
          <button className="ghost" onClick={() => setTick((t) => t + 1)}>
            Reload status
          </button>
          {msg && <span className="muted small">{msg}</span>}
        </div>
      </div>
    </div>
  );
}
