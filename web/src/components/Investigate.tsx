import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { NodeDetail } from '../api.ts';
import { api } from '../apiClient.ts';
import { badgesFor, categoryLabel, formatDate, locationLabel, relativeTime, TYPE_LABEL } from '../lib/format.ts';
import { useFetch } from '../lib/useFetch.ts';
import { Graph } from './Graph.tsx';

interface Props {
  id: string;
  onSelect: (id: string) => void;
  onClose: () => void;
  onBack?: () => void;
}

export function Investigate({ id, onSelect, onClose, onBack }: Props) {
  const [depth, setDepth] = useState(1);
  const detail = useFetch((s) => api.node(id, s), id);
  const graph = useFetch((s) => api.graph(id, depth, s), `${id}|${depth}`);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Move focus to the new item's heading so keyboard and screen-reader users land on what they opened.
  useEffect(() => {
    if (detail.data?.node.id === id) headingRef.current?.focus();
  }, [detail.data, id]);

  return (
    <aside
      className="investigate"
      aria-label="Investigation"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="inv-bar">
        {onBack && (
          <button className="ghost" onClick={onBack} aria-label="Back">
            ← Back
          </button>
        )}
        <span className="muted">Investigation</span>
        <button className="ghost" onClick={onClose} aria-label="Close investigation">
          ✕
        </button>
      </div>
      {detail.error && <div className="error">Could not load {id}: {detail.error.message}</div>}
      {detail.data && <DetailBody d={detail.data} headingRef={headingRef} />}
      <section className="inv-section">
        <div className="inv-section-head">
          <h3>Connections</h3>
          <div className="seg" role="group" aria-label="Graph depth">
            {[1, 2].map((d) => (
              <button key={d} className={depth === d ? 'on' : ''} onClick={() => setDepth(d)}>
                {d} hop{d > 1 ? 's' : ''}
              </button>
            ))}
          </div>
        </div>
        {graph.data && graph.data.nodes.length > 1 ? (
          <Graph nodes={graph.data.nodes} edges={graph.data.edges} rootId={id} onSelect={onSelect} />
        ) : (
          !graph.loading && <div className="muted small">No known relationships yet.</div>
        )}
      </section>
      {detail.data && <Relationships d={detail.data} onSelect={onSelect} />}
      {detail.data && <Provenance d={detail.data} />}
    </aside>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  if (children == null || children === '' || children === false) return null;
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

function DetailBody({ d, headingRef }: { d: NodeDetail; headingRef: React.RefObject<HTMLHeadingElement | null> }) {
  const n = d.node;
  const a = n.attrs ?? {};
  return (
    <section className="inv-head">
      <div className="inv-kicker">
        <span className={`pill pill-${n.type}`}>{TYPE_LABEL[n.type]}</span>
        {n.category && <span className="muted">{categoryLabel(n.category)}</span>}
      </div>
      <h2 ref={headingRef} tabIndex={-1}>
        {n.title}
      </h2>
      <div className="feed-foot">
        {badgesFor(n).map((b) => (
          <span key={b.label} className={`badge tone-${b.tone}`} title={b.title}>
            {b.label}
          </span>
        ))}
      </div>
      {n.summary && <p className="inv-summary">{n.summary}</p>}
      {n.url && (
        <a className="source-link" href={n.url} target="_blank" rel="noreferrer noopener">
          Open original source ↗
        </a>
      )}
      <dl className="facts">
        {n.type === 'vulnerability' && (
          <>
            <Fact label="CVE">{a.cveId}</Fact>
            <Fact label="CVSS">{a.cvss && `${a.cvss.score} ${a.cvss.severity ?? ''} · v${a.cvss.version} · ${a.cvss.vector}`}</Fact>
            <Fact label="EPSS">{a.epss && `${(a.epss.score * 100).toFixed(2)}% (percentile ${(a.epss.percentile * 100).toFixed(1)}) on ${a.epss.date}`}</Fact>
            <Fact label="KEV added">{a.kev?.dateAdded}</Fact>
            <Fact label="KEV due date">{a.kev?.dueDate}</Fact>
            <Fact label="Ransomware use">{a.kev?.ransomware}</Fact>
            <Fact label="Required action">{a.kev?.requiredAction}</Fact>
            <Fact label="NVD status">{a.nvd?.status}</Fact>
            <Fact label="GitHub advisory">
              {a.ghsa && (
                <span>
                  <a href={a.ghsa.url} target="_blank" rel="noreferrer noopener">
                    {a.ghsa.id}
                  </a>{' '}
                  ({a.ghsa.severity})
                  {a.ghsa.packages?.length > 0 && (
                    <ul className="pkg-list">
                      {a.ghsa.packages.slice(0, 12).map((p: { ecosystem: string; name: string; vulnerable: string | null; patched: string | null }) => (
                        <li key={`${p.ecosystem}/${p.name}`}>
                          <code>
                            {p.ecosystem} {p.name}
                          </code>{' '}
                          <span className="muted">
                            {p.vulnerable ?? ''}
                            {p.patched ? ` → fixed in ${p.patched}` : ' · no fix listed'}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </span>
              )}
            </Fact>
          </>
        )}
        {n.type === 'natural_event' && (
          <>
            <Fact label="Magnitude">{a.mag != null && `${a.mag} ${a.magType ?? ''}`}</Fact>
            <Fact label="Depth">{a.depthKm != null && `${Number(a.depthKm).toFixed(1)} km`}</Fact>
            <Fact label="First observed">{a.firstObserved && formatDate(a.firstObserved)}</Fact>
            <Fact label="Review status">{a.reviewStatus}</Fact>
            <Fact label="GDACS alert">
              {a.gdacs && (
                <span>
                  {a.gdacs.alertLevel}
                  {a.gdacs.severity ? ` · ${a.gdacs.severity}` : ''}
                  {a.gdacs.url && (
                    <>
                      {' · '}
                      <a href={a.gdacs.url} target="_blank" rel="noreferrer noopener">
                        GDACS report
                      </a>
                    </>
                  )}
                </span>
              )}
            </Fact>
            <Fact label="Affected countries">{a.gdacs?.affectedCountries?.length > 0 && a.gdacs.affectedCountries.join(', ')}</Fact>
            <Fact label="Upstream">{a.upstreamSources?.map((s: { id: string }) => s.id).join(', ')}</Fact>
          </>
        )}
        {n.type === 'article' && (
          <>
            <Fact label="Outlet">{a.outlet ? `${a.outlet} (${a.domain})` : a.domain}</Fact>
            <Fact label="Publisher country">
              {a.publisherCountry && (
                <span title={a.publisherCountryBasis}>
                  {a.publisherCountry}
                  {a.publisherCountryRef && (
                    <>
                      {' · '}
                      <a href={a.publisherCountryRef} target="_blank" rel="noreferrer noopener">
                        reference
                      </a>
                    </>
                  )}
                </span>
              )}
            </Fact>
            <Fact label="Discussion">
              {a.hnUrl && (
                <a href={a.hnUrl} target="_blank" rel="noreferrer noopener">
                  Hacker News ({a.comments} comments)
                </a>
              )}
            </Fact>
          </>
        )}
        {n.type === 'vendor' && a.wikidata && (
          <Fact label="Headquarters">
            {a.wikidata.status === 'matched' ? (
              <span>
                {a.wikidata.hq?.label}
                {a.wikidata.hq?.country ? `, ${a.wikidata.hq.country}` : ''} ·{' '}
                <a href={a.wikidata.url} target="_blank" rel="noreferrer noopener">
                  Wikidata {a.wikidata.qid}
                </a>
                <div className="muted small">
                  {a.wikidata.label}
                  {a.wikidata.description ? ` (${a.wikidata.description})` : ''}. Identity matched by {a.wikidata.matchedBy}:{' '}
                  <span className="basis basis-inferred">inferred · {Math.round(a.wikidata.confidence * 100)}%</span>
                  {a.wikidata.confidence < 0.7 && ' Possible match only, so it is not placed on the map.'}
                </div>
              </span>
            ) : (
              <span className="muted">
                {a.wikidata.status === 'ambiguous'
                  ? `Wikidata lookup ambiguous (${a.wikidata.candidates.length} candidates), so it is not placed on the map`
                  : 'No unambiguous Wikidata match, so it is not placed on the map'}
              </span>
            )}
          </Fact>
        )}
        {n.type === 'vendor' && Array.isArray(a.aliases) && a.aliases.length > 0 && (
          <Fact label="Also known as">
            <span title="Other spellings of this vendor (e.g. NVD CPE vendor IDs) merged into this node">
              {a.aliases.map((x: { name: string; rule: string }) => x.name).join(', ')}
              <span className="muted small"> · merged by name ({[...new Set(a.aliases.map((x: { rule: string }) => (x.rule === 'exact' ? 'same name without separators' : 'same name apart from a suffix')))].join('; ')})</span>
            </span>
          </Fact>
        )}
        <Fact label="SENTINEL rank">
          {a.rank && (
            <span title="A heuristic used to order the feed, not a fact reported by any source">
              {Number(a.rank.score).toFixed(2)} <span className="muted">· {a.rank.factors.join(' · ')}</span>
            </span>
          )}
        </Fact>
        <Fact label="Location">
          <span className={n.geoBasis ? '' : 'muted'}>{locationLabel(n)}</span>
        </Fact>
        <Fact label="Occurred">{n.occurredAt && `${formatDate(n.occurredAt)} (${relativeTime(n.occurredAt)})`}</Fact>
        <Fact label="Published">{n.publishedAt && formatDate(n.publishedAt)}</Fact>
        <Fact label="Updated">{n.updatedAt && formatDate(n.updatedAt)}</Fact>
        <Fact label="Ingested">{formatDate(n.ingestedAt)}</Fact>
      </dl>
      {a.nvd?.references?.length > 0 && (
        <details className="refs">
          <summary>References ({a.nvd.references.length})</summary>
          <ul>
            {a.nvd.references.map((r: { url: string; tags: string[] }) => (
              <li key={r.url}>
                <a href={r.url} target="_blank" rel="noreferrer noopener">
                  {r.url}
                </a>
                {r.tags.length > 0 && <span className="muted"> · {r.tags.join(', ')}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

const REL_TEXT: Record<string, string> = {
  'affects|out': 'Affects',
  'affects|in': 'Affected by',
  'made_by|out': 'Made by',
  'made_by|in': 'Makes',
  'has_weakness|out': 'Weakness',
  'has_weakness|in': 'Seen in',
  'mentions|out': 'Mentions',
  'mentions|in': 'Mentioned by',
  'references|out': 'References',
  'references|in': 'Referenced by',
};
const describe = (rel: string, dir: 'in' | 'out') => REL_TEXT[`${rel}|${dir}`] ?? rel;

function Relationships({ d, onSelect }: { d: NodeDetail; onSelect: (id: string) => void }) {
  const groups = new Map<string, NodeDetail['edges']>();
  for (const e of d.edges) {
    const k = describe(e.rel, e.direction);
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }
  if (!groups.size) return null;
  return (
    <section className="inv-section">
      <h3>Relationships</h3>
      {[...groups].map(([label, edges]) => (
        <div key={label} className="rel-group">
          <div className="rel-label">
            {label} <span className="muted">({edges.length})</span>
          </div>
          <ul>
            {edges
              .slice()
              .sort((x, y) => (y.other.occurredAt ?? '').localeCompare(x.other.occurredAt ?? ''))
              .slice(0, 40)
              .map((e) => (
                <li key={`${e.src}|${e.dst}|${e.rel}`}>
                  <button className="link-btn" onClick={() => onSelect(e.other.id)}>
                    {e.other.title}
                  </button>
                  <span className={`basis basis-${e.basis}`} title={e.rationale ?? `Reported by ${e.sourceId}`}>
                    {e.basis === 'reported' ? `reported · ${e.sourceId}` : `inferred · ${Math.round(e.confidence * 100)}%`}
                  </span>
                  {e.basis === 'inferred' && e.rationale && <div className="rationale">{e.rationale}</div>}
                </li>
              ))}
          </ul>
          {edges.length > 40 && <div className="muted small">…and {edges.length - 40} more</div>}
        </div>
      ))}
    </section>
  );
}

function Provenance({ d }: { d: NodeDetail }) {
  return (
    <section className="inv-section">
      <h3>Sources</h3>
      <ul className="prov">
        {d.provenance.map((p) => (
          <li key={p.id}>
            <a href={p.sourceUrl ?? p.homepage} target="_blank" rel="noreferrer noopener">
              {p.name}
            </a>
            <span className="muted"> · fetched {formatDate(p.fetchedAt)}</span>
            <div className="muted small">{p.description}</div>
          </li>
        ))}
      </ul>
    </section>
  );
}

