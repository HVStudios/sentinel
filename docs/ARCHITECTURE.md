# SENTINEL — Architecture

## Overview

```
                ┌──────────────────────── server (Node 24, TypeScript) ────────────────────────┐
 public APIs    │  sources/*        pure parse()   ┌────────┐   relate.ts     ┌─────────────┐   │
 KEV · NVD ───► │  fetch() ───────► Batch ───────► │ store  │ ◄─────────────► │  inference  │   │
 EPSS · USGS    │  (rate-limited,   {nodes, edges, │ SQLite │                 └─────────────┘   │
 EONET · GDELT  │   retry, timeout)  provenance}   │(node:  │                                   │
 HN Algolia     │                                  │ sqlite)│ ◄── api.ts (Fastify, JSON) ◄──┐   │
                └──────────────────────────────────┴────────┴───────────────────────────────│───┘
                                                                                             │
                ┌──────────────────────── web (Vite + React + TypeScript) ─────────────────┐ │
                │  WorldMap (d3-geo, Equal Earth, world-atlas)   EventFeed   Timeline       │─┘
                │  Investigate (detail + d3-force graph)         SourcesPanel               │
                └──────────────────────────────────────────────────────────────────────────┘
```

A single repository with two npm workspaces:

| Path | Purpose |
|---|---|
| `server/` | Ingestion, storage, relationship inference, HTTP API. Runs TypeScript directly with Node 24's built-in type stripping, so it needs no build step. |
| `web/` | Single-page app built by Vite. During development Vite proxies `/api` to the server. In production the server serves `web/dist`. |
| `docs/` | Product, architecture, backlog. |

## Technology choices

| Concern | Choice | Why |
|---|---|---|
| Runtime | Node 24 | Built-in TypeScript type stripping and built-in `node:sqlite`, so the database needs no native modules. |
| Storage | SQLite (`node:sqlite`), file at `data/sentinel.db` | Zero infrastructure, transactional, enough for tens of thousands of nodes. |
| HTTP | Fastify 5 | Small and fast, with first-class schema validation and `inject()` for tests. |
| UI | React 19 + Vite | Mainstream, fast dev loop. |
| Map | `d3-geo` + `world-atlas` TopoJSON (Natural Earth 1:110m) | Needs no tile server or API key, works offline, and is projection-accurate. |
| Graph | `d3-force` rendered as SVG by React | Lightweight. No large graph library needed for 1–2 hop neighbourhoods. |
| Tests | Vitest (server and web), Testing Library + jsdom | One test runner and fast. |
| CI | GitHub Actions | Runs typecheck, tests and build on every push and PR. |

## Data model

Everything is a **node** in one graph. Time-bound nodes (vulnerabilities, events,
articles) appear in the feed, timeline and map. Reference nodes (vendor, product, weakness,
source) appear in investigations.

```
nodes(id PK, type, title, summary, url, category,
      occurred_at, published_at, updated_at, ingested_at,
      lat, lon, country, geo_basis, severity, attrs JSON)
edges(src, dst, rel, basis, confidence, rationale, source_id, observed_at,
      PK(src, dst, rel))
provenance(node_id, source_id, source_url, fetched_at, PK(node_id, source_id))
sources(id PK, name, homepage, description, last_run_at, last_status,
        last_count, last_error, last_duration_ms)
```

- **Node IDs** are namespaced and stable: `cve:CVE-2021-44228`, `vendor:ivanti`,
  `product:ivanti/connect-secure`, `cwe:CWE-306`, `quake:us7000ttxz`,
  `eonet:EONET_25827`, `news:<sha1(url)>`, `hn:50307183`, `source:cisa-kev`.
- **Node types**: `vulnerability`, `natural_event`, `article`, `vendor`, `product`,
  `weakness`, `source`.
- **Timestamps** are ISO-8601 UTC. `occurred_at` is when the thing happened (the
  earthquake time, the KEV date added, the CVE publish date). `published_at` is when
  the source published it. `ingested_at` is when SENTINEL stored it.
- **Geography**: `geo_basis` records why a node has a location.
  - `coordinates`: the source supplies lat/lon (USGS, EONET).
  - `publisher_country`: the publishing outlet's country (GDELT, or the curated feed registry).
    This is *not* where the event happened, and the UI labels it as publisher country.
  - `null`: no location. This applies to all vulnerabilities.
- **Severity** is normalised to 0–1 so the map and feed can rank items consistently. The raw
  values are kept in `attrs`.
  - Vulnerabilities: KEV-listed CVEs take 0.90–1.00 and all others 0–0.89 (confirmed
    exploitation outranks theoretical severity). Within each band, max(CVSS/10, EPSS) decides.
  - Natural events: scaled from magnitude (earthquakes), acreage (wildfires) or wind (storms).
  - Articles have no source severity. SENTINEL assigns a heuristic rank (category base, Hacker
    News points, mentions of KEV-listed or known CVEs). Every contribution is stored in
    `attrs.rank.factors`, and the UI shows it as "SENTINEL rank", not as a fact.
- **Edges** have `basis = reported | inferred`. Inferred edges always have
  `confidence` and `rationale`.

## Ingestion

Each source module in `server/src/sources/` exports:

```ts
interface SourceModule {
  meta: SourceMeta;                                   // id, name, homepage, description
  run(ctx: IngestContext): Promise<Batch>;            // fetch + parse
}
```

Parsing is split into **pure functions** (`parseKev(json)`, `parseUsgs(geojson)`…). They
are tested against recorded fixtures in `server/test/fixtures/`. The HTTP layer
(`http.ts`) handles timeouts, retries with backoff, and polite rate limiting (NVD allows
5 requests per 30 s without an API key; `NVD_API_KEY` can be set to raise that limit).

`ingest.ts` runs each source independently and writes each batch in a transaction. It
records per-source status in `sources`, so one failing source never blocks the others.
After all sources run, `relate.ts` recomputes inferred edges.

Order: KEV → NVD (KEV CVEs missing details, plus CVEs published in the last N days) →
GitHub advisories → EPSS (for all stored CVEs) → Wikidata vendor HQs → USGS → EONET → GDACS →
curated feeds → GDELT → HN → inference.

A source may return non-fatal `warnings` (e.g. 2 of 17 feeds failed). The source then stays
`ok`, and the warnings are stored in `last_error` so the Sources panel shows them.

**GitHub Security Advisories** (`sources/ghsa.ts`): reviewed high and critical advisories from the
last 7 days, paged via the `Link` header. An advisory with a CVE enriches the existing CVE node
(GitHub's facts only; KEV/NVD title and CVSS are kept) or creates it. One without a CVE becomes a
`ghsa:` vulnerability node. Affected packages are product nodes `package:<ecosystem>/<name>`,
with version ranges and fixes kept on the advisory. Articles that mention a GHSA ID get an
inferred `mentions` edge, like CVE IDs.

**GDACS** (`sources/gdacs.ts`): every Orange/Red alert from the last 30 days, plus Green cyclones
and volcanoes. An event that is already on the map is enriched rather than duplicated: an
earthquake within 2 minutes and 100 km of a USGS quake, or a cyclone whose name appears in an
EONET storm title. Points are GDACS's epicentre or centroid of the affected area, labelled as
such. Droughts, and events affecting more than three countries, get no point at all, because a
centroid in one country would misrepresent a continent-wide event; their affected countries are
listed instead.

**Vendor de-duplication** (`dedupe.ts`): after any source that writes vendor nodes, duplicate
spellings of one company are folded together. Rule 1 merges names that are identical once
separators are removed (Paloaltonetworks → Palo Alto Networks). Rule 2 merges names that differ
only by a trailing word such as Inc, Corp, GmbH, Project, Networks or Security, but only into a
single KEV-named vendor (Zohocorp → Zoho), and never by prefix (Intellian ≠ Intel). Products move
with their vendor, and same-named products merge. The KEV spelling survives, and the other
spellings are kept in `attrs.aliases` with the rule that matched.

**Vendor headquarters** (`sources/wikidata.ts`): vendors are looked up on the Wikidata SPARQL
endpoint by name and a few variants ("Inc.", "Corporation", "Networks", "Systems", "Software").
Only items with a headquarters (P159) whose English description marks them as a technology
organisation count, which is what keeps "Apple" from resolving to Apple Records. Resolution
rules: single candidate → the one exact-label match → several candidates sharing one
headquarters → otherwise ambiguous. The vendor-to-item identity is *inferred*
(confidence 0.8 exact label, 0.7 name variant, 0.55 alias only); the headquarters city,
country and coordinates are *reported* by Wikidata, with the item URL as provenance. Only
label matches (≥ 0.7) are mapped, because about 1 in 6 alias matches were wrong in testing.
Runs are time-boxed (2 minutes, most-affected vendors first, no retries), and the Pages
workflow caches the database, so lookups accumulate and are re-checked every 30 days.

**Curated feeds** (`sources/feeds.ts`, `sources/rss.ts`): a registry of RSS/Atom feeds. Each entry
has the publisher's country and a `countryRef` page that confirms it. Items get
`geo_basis = publisher_country` and carry the basis and reference in `attrs`. Items without a
parseable date or link are dropped, and so are items older than 30 days or dated in the future.
Articles use the same `news:<sha1(url)>` id as GDELT, so an article seen by both is stored once.

## Relationship inference (`relate.ts`)

| Rule | Basis | Confidence |
|---|---|---|
| KEV/NVD: CVE `affects` product, product `made_by` vendor | reported | 1.0 |
| NVD: CVE `has_weakness` CWE | reported | 1.0 |
| Article title/summary contains an exact CVE ID that exists in the store → `mentions` | inferred | 0.95 |
| Article contains a known vendor name (word boundary, ≥ 4 chars, stop-list for generic names) → `mentions` | inferred | 0.6 |

Inferred edges are deleted and recomputed on every run, so they stay consistent with
the current data. The same step recomputes vulnerability severity and article ranks.

## Feed ordering

A chronological feed is dominated by whichever category publishes most (a few days of NVD
CVEs). `mixed` and `top` take from each category in turn: each category keeps its own offset,
the cursor carries all of them (`mix:vulnerability=12,natural_event=4,article=5`), and if one
category runs out the others fill the page. The static engine implements the same algorithm,
and the parity test covers all three orderings.

## API

| Endpoint | Description |
|---|---|
| `GET /api/health` | Liveness and DB counts. |
| `GET /api/feed?from&to&types&q&sort&limit&before` | Time-bound nodes with cursor pagination. `sort` is `latest` (chronological), `mixed` (one category at a time, newest first within each) or `top` (one category at a time, by severity/rank). |
| `GET /api/map?from&to&types` | `{ points[], countries[], vendors[] }`: geolocated nodes, publisher-country aggregates, and Wikidata headquarters of vendors behind vulnerabilities in the window. |
| `GET /api/timeline?from&to&types` | Histogram buckets per node type. |
| `GET /api/nodes/:id` | Node, provenance and adjacent edges. |
| `GET /api/graph/:id?depth=1..2&limit` | Neighbourhood subgraph. |
| `GET /api/sources` | Source metadata and last-run status. |
| `POST /api/ingest` | Triggers a refresh (single-flight). Only bound when the server listens on localhost. |

## Testing strategy

- **Unit**: parsers against real recorded payloads, normalisers, inference rules, and
  country-name mapping.
- **Integration**: store and API using an in-memory SQLite DB and Fastify `inject()`.
- **UI**: component tests for the feed, filters, detail panel and map rendering (jsdom).
- **End-to-end**: Playwright drives Chromium against the live server and the static Pages
  build (`e2e/`). Both use the same database, seeded offline from the shared fixture router
  (`server/test/fixtures/router.ts`), and the browser clock is frozen at the fixtures' date.
  `e2e/a11y.spec.ts` adds an axe-core WCAG 2.2 A/AA audit, keyboard-only flows (roving focus
  on the map and graph, focus return, modal focus trap) and phone-width layout checks.
- **No network in tests**. Live fetching is exercised only by `npm run ingest`.

## Static deployment (GitHub Pages)

The web app has two data back-ends behind one `Api` interface (`web/src/api.ts`):

- **live** (default): HTTP calls to the local server.
- **static** (`VITE_STATIC=1`): downloads `snapshot.json` once and answers feed, map, timeline,
  node and graph queries in the browser (`web/src/staticApi.ts`).

`npm run export` writes the snapshot from the SQLite store (`server/src/snapshot.ts`), about
11 MB raw and about 1 MB gzipped. `server/test/static-parity.test.ts` runs the full offline
ingest, round-trips the snapshot through JSON, and asserts the static engine returns exactly
what the SQL queries return (paging cursors, map aggregates, timeline buckets, graph
truncation).

`.github/workflows/pages.yml` runs on pushes to `main`, every 6 hours, and on demand. It
runs tests, ingests live data, exports, builds with `VITE_BASE=/<repo>/`, and deploys with
`actions/deploy-pages`. Routing uses `#/node/<id>` hashes, so deep links work without
server rewrites. An optional `NVD_API_KEY` repository secret speeds up the NVD step.

## Operational notes

- Config via env: `PORT` (default 8787), `HOST` (default 127.0.0.1),
  `SENTINEL_DB` (default `data/sentinel.db`), `NVD_API_KEY` (optional),
  `NVD_RECENT_DAYS` (default 3).
- The server binds to `127.0.0.1` by default. Nothing is deployed publicly.
