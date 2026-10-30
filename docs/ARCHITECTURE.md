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
  - `publisher_country`: the source supplies the publishing outlet's country (GDELT).
    This is *not* where the event happened, and the UI labels it as publisher country.
  - `null`: no location. This applies to all vulnerabilities.
- **Severity** is normalised to 0–1 so the map and feed can rank items consistently
  (max(CVSS/10, EPSS), earthquake magnitude scaled, etc.). The raw values are kept in
  `attrs`.
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
EPSS (for all stored CVEs) → USGS → EONET → GDELT → HN → inference.

## Relationship inference (`relate.ts`)

| Rule | Basis | Confidence |
|---|---|---|
| KEV/NVD: CVE `affects` product, product `made_by` vendor | reported | 1.0 |
| NVD: CVE `has_weakness` CWE | reported | 1.0 |
| Article title/summary contains an exact CVE ID that exists in the store → `mentions` | inferred | 0.95 |
| Article contains a known vendor name (word boundary, ≥ 4 chars, stop-list for generic names) → `mentions` | inferred | 0.6 |

Inferred edges are deleted and recomputed on every run, so they stay consistent with
the current data.

## API

| Endpoint | Description |
|---|---|
| `GET /api/health` | Liveness and DB counts. |
| `GET /api/feed?from&to&types&q&limit&before` | Time-bound nodes, newest first, cursor pagination. |
| `GET /api/map?from&to&types` | `{ points[], countries[] }`: geolocated nodes and publisher-country aggregates. |
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
- **No network in tests**. Live fetching is exercised only by `npm run ingest`.

## Operational notes

- Config via env: `PORT` (default 8787), `HOST` (default 127.0.0.1),
  `SENTINEL_DB` (default `data/sentinel.db`), `NVD_API_KEY` (optional),
  `NVD_RECENT_DAYS` (default 3).
- The server binds to `127.0.0.1` by default. Nothing is deployed publicly.
