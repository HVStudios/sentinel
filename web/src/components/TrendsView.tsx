import { useState } from 'react';
import type { Trends } from '../api.ts';
import { api } from '../apiClient.ts';
import { formatDate } from '../lib/format.ts';
import { useFetch } from '../lib/useFetch.ts';
import { epssPercent } from './EpssSparkline.tsx';

const WINDOWS = [30, 90, 365] as const;
const W = 960;
const H = 120;
const PAD_B = 16;

interface Series {
  label: string;
  values: number[];
  className: string;
}

/** Stacked weekly bars; the accessible name summarises the data for screen readers. */
function WeeklyBars({ weeks, series, label }: { weeks: string[]; series: Series[]; label: string }) {
  const totals = weeks.map((_, i) => series.reduce((s, x) => s + (x.values[i] ?? 0), 0));
  const max = Math.max(1, ...totals);
  const bw = W / weeks.length;
  const peak = totals.indexOf(Math.max(...totals));
  const summary = `${label}: ${totals.reduce((a, b) => a + b, 0)} in ${weeks.length} weeks; most in the week of ${weeks[peak]} (${totals[peak]}).`;
  const monthTicks = weeks.map((w, i) => ({ w, i })).filter(({ w }, idx) => idx === 0 || w.slice(5, 7) !== weeks[idx - 1]!.slice(5, 7));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="trend-bars" role="img" aria-label={summary} preserveAspectRatio="none">
      {weeks.map((week, i) => {
        let y = H - PAD_B;
        return series.map((s) => {
          const v = s.values[i] ?? 0;
          if (!v) return null;
          const h = (v / max) * (H - PAD_B - 6);
          y -= h;
          return (
            <rect key={`${s.label}-${week}`} x={i * bw + 1} y={y} width={Math.max(bw - 2, 1)} height={h} className={s.className}>
              <title>{`Week of ${week}: ${v} ${s.label}`}</title>
            </rect>
          );
        });
      })}
      <line x1={0} x2={W} y1={H - PAD_B} y2={H - PAD_B} className="axis" />
      {monthTicks.filter((_, k) => k % 2 === 0).map(({ w, i }) => (
        <text key={w} x={i * bw + 2} y={H - 3} className="tick">
          {new Date(`${w}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', year: '2-digit', timeZone: 'UTC' })}
        </text>
      ))}
    </svg>
  );
}

function RankList({ title, items, onSelect }: { title: string; items: Trends['topVendors']; onSelect: (id: string) => void }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <div className="rank">
      <h3>{title}</h3>
      {items.length === 0 ? (
        <p className="muted small">None in this window.</p>
      ) : (
        <ol>
          {items.map((i) => (
            <li key={i.id}>
              <button className="link-btn" onClick={() => onSelect(i.id)}>
                {i.name}
              </button>
              <span className="rank-bar" style={{ width: `${(i.count / max) * 100}%` }} aria-hidden="true" />
              <span className="rank-count">{i.count}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

const shortDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });

function EpssMovers({ data, onSelect }: { data: Trends; onSelect: (id: string) => void }) {
  const [days, setDays] = useState<number>(data.epssMovers[0]?.days ?? 7);
  const movers = data.epssMovers.find((m) => m.days === days)?.movers ?? [];
  return (
    <section className="trend-card" aria-labelledby="epss-movers">
      <div className="trend-head">
        <h3 id="epss-movers">Largest rises in exploitation likelihood (EPSS), last {days} days</h3>
        <div className="seg seg-sm" role="group" aria-label="EPSS period">
          {data.epssMovers.map((m) => (
            <button key={m.days} className={m.days === days ? 'on' : ''} aria-pressed={m.days === days} onClick={() => setDays(m.days)}>
              {m.days}d
            </button>
          ))}
        </div>
      </div>
      {movers.length === 0 ? (
        <p className="muted small">No CVE&apos;s EPSS score rose by 0.1 percentage points or more in this period.</p>
      ) : (
        <table className="movers">
          <thead>
            <tr>
              <th>Vulnerability</th>
              <th>EPSS</th>
              <th>Rise</th>
            </tr>
          </thead>
          <tbody>
            {movers.map((m) => (
              <tr key={m.id}>
                <td>
                  <button className="link-btn" onClick={() => onSelect(m.id)}>
                    {m.id.replace(/^cve:/, '')}
                  </button>{' '}
                  {m.kev && (
                    <span className="badge tone-critical" title="Listed in CISA Known Exploited Vulnerabilities">
                      KEV
                    </span>
                  )}
                  <div className="muted small">{m.title}</div>
                </td>
                <td>
                  {epssPercent(m.from)} → <strong>{epssPercent(m.to)}</strong>
                  <div className="muted small">
                    {shortDate(m.fromDate)} – {shortDate(m.toDate)}
                  </div>
                </td>
                <td>
                  +{((m.to - m.from) * 100).toFixed(m.to - m.from < 0.01 ? 2 : 1)} pp
                  <div className="muted small">×{(m.to / m.from).toFixed(m.to / m.from < 10 ? 1 : 0)}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="trend-source muted small">
        Source: FIRST EPSS, the estimated probability of exploitation in the next 30 days. SENTINEL&apos;s stored history starts{' '}
        {data.epssHistorySince ? shortDate(data.epssHistorySince) : '—'}; a CVE scored for the first time during the period is compared
        from its first score, so its date range is shorter. Ranked by the rise in percentage points (pp).
      </p>
    </section>
  );
}

export function TrendsView({ onSelect, dataVersion }: { onSelect: (id: string) => void; dataVersion: string }) {
  const [windowDays, setWindowDays] = useState<(typeof WINDOWS)[number]>(90);
  const { data, error, loading } = useFetch((s) => api.trends(windowDays, s), `${windowDays}|${dataVersion}`);

  return (
    <div className="trends" aria-busy={loading}>
      {error && <div className="error">Could not load trends: {error.message}</div>}
      {data && (
        <>
          <section className="trend-card" aria-labelledby="kev-weekly">
            <h3 id="kev-weekly">Known exploited vulnerabilities added per week</h3>
            <WeeklyBars
              weeks={data.weeks}
              label="KEV additions"
              series={[
                { label: 'linked to ransomware', values: data.kevWeekly.ransomware, className: 'bar-ransomware' },
                { label: 'other', values: data.kevWeekly.total.map((t, i) => t - (data.kevWeekly.ransomware[i] ?? 0)), className: 'bar-vulnerability' },
              ]}
            />
            <div className="trend-legend">
              <span className="legend-item">
                <i className="swatch-ransomware" /> Known ransomware use
              </span>
              <span className="legend-item">
                <i className="swatch-vulnerability" /> Other KEV additions
              </span>
            </div>
            <p className="trend-source muted small">
              Source: CISA Known Exploited Vulnerabilities catalogue, by the date CISA added each entry. Complete history: SENTINEL never
              expires KEV entries.
            </p>
          </section>

          <section className="trend-card" aria-labelledby="kev-rankings">
            <div className="trend-head">
              <h3 id="kev-rankings">
                Most affected in the last {windowDays} days: {data.kevInWindow} KEV additions, {data.ransomwareInWindow} linked to ransomware
              </h3>
              <div className="seg seg-sm" role="group" aria-label="Ranking window">
                {WINDOWS.map((w) => (
                  <button key={w} className={w === windowDays ? 'on' : ''} aria-pressed={w === windowDays} onClick={() => setWindowDays(w)}>
                    {w === 365 ? '1y' : `${w}d`}
                  </button>
                ))}
              </div>
            </div>
            <div className="ranks">
              <RankList title="Vendors" items={data.topVendors} onSelect={onSelect} />
              <RankList title="Products" items={data.topProducts} onSelect={onSelect} />
              <RankList title="Weaknesses (CWE)" items={data.topWeaknesses} onSelect={onSelect} />
            </div>
            <p className="trend-source muted small">Source: CISA KEV (vendor and product as CISA names them; weaknesses from KEV and NVD).</p>
          </section>

          <EpssMovers data={data} onSelect={onSelect} />

          <section className="trend-card" aria-labelledby="collected-weekly">
            <h3 id="collected-weekly">News and events collected by SENTINEL, by publication week</h3>
            <WeeklyBars
              weeks={data.weeks}
              label="Items collected"
              series={[
                { label: 'news & tech articles', values: data.collectedWeekly.article, className: 'bar-article' },
                { label: 'world events', values: data.collectedWeekly.natural_event, className: 'bar-natural_event' },
              ]}
            />
            <div className="trend-legend">
              <span className="legend-item">
                <i className="swatch-article" /> News &amp; tech
              </span>
              <span className="legend-item">
                <i className="swatch-natural_event" /> World events
              </span>
            </div>
            <p className="trend-source muted small">
              This counts SENTINEL&apos;s own collection, not world activity. Collection began {formatDate(data.collectedSince)}; weeks before
              that only contain items that were still in the sources&apos; feeds at that point, so they are incomplete. News is kept for 90 days
              and world events for 180.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
