# SENTINEL — Product Specification

## Vision

SENTINEL is a lightweight **intelligence exploration platform**. It brings together
cybersecurity and vulnerability intelligence, technology and AI news, and significant
world events. Users can then see what is happening, how things connect, and how
they develop over time.

It is not a vulnerability dashboard. The main interaction is *exploration*: you start from
the map or the feed, open an item, follow its relationships to products, vendors,
sources and other events, and narrow the time window to see how a story develops.

## Users

- **Security analyst / engineer** — "What is being actively exploited right now, how risky
  is it, and which vendors and products are involved?"
- **Technology watcher** — "What's notable in tech and AI today, and does it relate to
  anything in security?"
- **Situational-awareness reader** — "What significant things are happening in the world,
  and where?"

## Core principles

1. **Real data, attributed.** Every record keeps its source, source URL, and timestamps:
   when the event happened, when the source published it, and when SENTINEL ingested it.
2. **No invented geography.** An item appears on the map only if a source gives it
   coordinates (e.g. USGS, NASA EONET) or gives a country explicitly (e.g. GDELT
   *publisher country*). Vulnerabilities have no location in KEV/NVD, so they are not
   placed on the map. The UI says so instead of guessing.
3. **Facts vs. inferences vs. uncertainty.** Every relationship has a `basis`:
   - `reported`: stated directly by a source (e.g. KEV says CVE-X affects Vendor/Product).
   - `inferred`: derived by SENTINEL (e.g. a news headline mentions a CVE ID or a vendor
     name). Inferred relationships include a `confidence` (0–1) and a human-readable
     `rationale`.
   The UI draws reported links as solid lines and inferred ones as dashed lines, and labels
   them.
4. **Free and self-contained.** No paid services, no commercial LLM, no infrastructure
   beyond a single Node process and a SQLite file.

## MVP scope

| Area | MVP capability |
|---|---|
| Ingestion | CISA KEV, NVD (CVSS, CWE, affected products, references) for KEV + recently published CVEs, FIRST EPSS, USGS significant earthquakes, NASA EONET natural events, GDELT news articles (publisher country), Hacker News tech/AI stories. CLI + API-triggered refresh, idempotent upserts, per-source status. |
| Relationships | Reported: CVE→product, product→vendor, CVE→CWE, item→source. Inferred: news→CVE (exact ID mention, high confidence), news→vendor (name match, medium confidence). |
| World map | Equal Earth projection, zoom/pan. Point events (earthquakes, wildfires, storms, volcanoes…) at their true coordinates. Country shading for news volume by publisher country (clearly labeled). Click → detail. |
| Event feed | Unified chronological feed across categories. Filter by category, time window and free-text search. Badges for KEV, EPSS, CVSS severity, ransomware use. |
| Investigation | Entity detail panel showing facts, provenance and timestamps, plus an interactive relationship graph (1–2 hops) with reported/inferred styling. You can navigate graph → entity → graph. |
| Timeline | Activity histogram for the selected window. Brushing it filters the map and the feed. |
| Ops | Ingestion status (last run, count, error per source). |

### Out of scope for the MVP

User accounts, alerting, saved investigations, LLM summarisation, vendor HQ geocoding,
public deployment.

## Success criteria for the MVP

- `npm run ingest` fills the database from live public sources. If one source fails,
  the others still load.
- The UI loads at `localhost` and shows a populated map, feed, timeline and investigation
  graph.
- Every displayed item links to its original source and shows its timestamps.
- Automated tests cover parsers (against recorded fixtures), relationship inference,
  storage, API and key UI components. CI runs lint, typecheck, tests and build.
