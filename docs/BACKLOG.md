# SENTINEL — Backlog

This file is the source of truth for the backlog until it is mirrored into GitHub Issues.
`node scripts/create-github-issues.mjs` creates one issue per `###` entry below. Its
`--dry-run` flag prints the issues instead of creating them. Each entry has an ID, a
priority (P0 = MVP), labels, a status, and acceptance criteria.

Status values: `todo` · `in-progress` · `done (branch)`.

## P0 — MVP

### SEN-01 · Project scaffold, tooling and CI
Priority: P0 · Labels: infra · Status: done (feature/sen-01-scaffold)

npm workspaces (`server`, `web`), strict TypeScript, Vitest, GitHub Actions CI running
typecheck, tests and build.

- [x] `npm install && npm test` passes on a fresh clone
- [x] CI workflow runs on push and pull_request

### SEN-02 · SQLite store and domain model
Priority: P0 · Labels: backend, data · Status: done (feature/sen-02-store)

Nodes, edges, provenance and sources tables using `node:sqlite`. Idempotent upserts,
transactional batch writes, query helpers.

- [x] Upserting the same batch twice produces identical state
- [x] Every node has at least one provenance record
- [x] Unit tests with in-memory DB

### SEN-03 · Ingest CISA KEV
Priority: P0 · Labels: backend, ingestion · Status: done (feature/sen-03-ingest)

Parse the KEV JSON feed into vulnerability, vendor, product and CWE nodes with
reported edges.

- [x] Parser tested against recorded fixture
- [x] dateAdded → occurred_at; ransomware use, due date, required action kept

### SEN-04 · NVD enrichment
Priority: P0 · Labels: backend, ingestion · Status: done (feature/sen-03-ingest)

Fetch CVE details (CVSS v3.x/v4, CWE, references, description) for KEV CVEs that lack
them and for recently published CVEs. Respect rate limits.

- [x] Rate limiter: ≤ 5 req/30 s without key, ≤ 50 with key
- [x] Parser tested against recorded fixture

### SEN-05 · FIRST EPSS scores
Priority: P0 · Labels: backend, ingestion · Status: done (feature/sen-03-ingest)

Batch-fetch EPSS score and percentile for stored CVEs.

- [x] Batches of ≤ 100 CVEs; score date kept

### SEN-06 · Geolocated world events (USGS, NASA EONET)
Priority: P0 · Labels: backend, ingestion, geo · Status: done (feature/sen-03-ingest)

- [x] Coordinates taken verbatim from source; `geo_basis = coordinates`
- [x] Parsers tested against fixtures

### SEN-07 · News and tech sources (GDELT, Hacker News)
Priority: P0 · Labels: backend, ingestion · Status: done (feature/sen-03-ingest)

- [x] GDELT publisher country stored as `country` with `geo_basis = publisher_country` (never as event location)
- [x] HN stories have no geography
- [x] Source failure is recorded and does not abort the run

### SEN-08 · Relationship inference
Priority: P0 · Labels: backend, analysis · Status: done (feature/sen-03-ingest)

- [x] CVE-ID mention → inferred edge, confidence 0.95
- [x] Vendor-name mention → inferred edge, confidence 0.6, with stop-list
- [x] Inferred edges recomputed each run; reported edges untouched

### SEN-09 · HTTP API
Priority: P0 · Labels: backend, api · Status: done (feature/sen-04-api)

Feed, map, timeline, node, graph, sources and ingest endpoints (see ARCHITECTURE.md).

- [x] Integration tests via Fastify `inject()`
- [x] Input validation for query params

### SEN-10 · Web shell and world map
Priority: P0 · Labels: frontend, geo · Status: done (feature/sen-05-web)

- [x] Equal Earth map, zoom/pan, points at true coordinates
- [x] Publisher-country shading labelled as such; unmapped countries reported
- [x] Click point → opens investigation

### SEN-11 · Event feed with filters
Priority: P0 · Labels: frontend · Status: done (feature/sen-05-web)

- [x] Category toggles, time window, text search
- [x] KEV / EPSS / CVSS / ransomware badges, source attribution and timestamps

### SEN-12 · Investigation view and relationship graph
Priority: P0 · Labels: frontend, analysis · Status: done (feature/sen-05-web)

- [x] Facts, provenance and timestamps for any node
- [x] Force graph, reported solid vs inferred dashed with confidence on hover
- [x] Navigate by clicking graph nodes

### SEN-13 · Timeline
Priority: P0 · Labels: frontend · Status: done (feature/sen-05-web)

- [x] Stacked histogram by type; brush selects time window for map and feed

### SEN-14 · Documentation
Priority: P0 · Labels: docs · Status: done (feature/sen-05-web)

- [x] README: install, ingest, run, test
- [x] Backlog statuses reflect reality

### SEN-24 · Hosted static site on GitHub Pages
Priority: P0 · Labels: infra, frontend · Status: done (feature/sen-24-pages)

Make SENTINEL viewable without running it locally. A scheduled GitHub Actions workflow runs
the ingest and exports a JSON snapshot. The web app is built in *static mode*, which answers
the same queries client-side from that snapshot. The result is deployed to GitHub Pages.

- [x] `npm run export` writes a self-contained snapshot (all nodes, edges, provenance, source status)
- [x] Static mode implements feed, map, timeline, node and graph queries client-side, with tests
- [x] Workflow: scheduled refresh, ingest, export, build, deploy to Pages
- [x] UI shows snapshot time and hides the refresh action in static mode
- [ ] Pages enabled on the repository (needs a public repo or a paid plan for private Pages)

## P1 — Next

### SEN-15 · Scheduled refresh and ingest status panel
Priority: P1 · Labels: backend, frontend · Status: in-progress

Optional in-process interval refresh (`SENTINEL_REFRESH_MINUTES`) and a UI panel showing
last run, counts and errors per source.

- [x] Sources panel with last run, status, count and error; manual "Refresh all sources" (feature/sen-05-web)
- [ ] Interval refresh via `SENTINEL_REFRESH_MINUTES`
- [ ] Poll ingest status while running and refresh map and feed when it finishes

### SEN-16 · Vendor headquarters geography (Wikidata, attributed)
Priority: P1 · Labels: geo, data · Status: todo

Resolve vendor → Wikidata entity → HQ country, only on an unambiguous match. Store it as
an inferred relationship with the Wikidata QID as provenance and show it on the map as
"vendor HQ (Wikidata)". Never place a vulnerability itself on the map.

### SEN-17 · End-to-end tests (Playwright)
Priority: P1 · Labels: testing · Status: todo

Seeded DB fixture, smoke flows: load → filter → open investigation → navigate graph.

### SEN-18 · Additional sources
Priority: P1 · Labels: ingestion · Status: todo

CISA cybersecurity advisories (RSS), GDACS disaster alerts, GitHub Security Advisories.

### SEN-19 · Watchlists and saved investigations
Priority: P1 · Labels: frontend, backend · Status: todo

Track vendors, products or CVEs locally and highlight new related items.

### SEN-20 · Accessibility and responsive layout pass
Priority: P1 · Labels: frontend, a11y · Status: todo

Keyboard navigation for map and graph, ARIA labels, mobile layout, contrast audit.

### SEN-22 · Reliable news source with publisher country
Priority: P1 · Labels: ingestion, geo · Status: todo

GDELT DOC 2.0 returned HTTP 429 or empty results for most requests during development. The
pipeline already records the failure and carries on. Next steps: honour GDELT's
one-request-per-5-seconds limit across runs (persist the last request time), add backoff
across runs, and evaluate a second news source that gives the publisher country (for example
curated RSS feeds whose outlet country is configured explicitly and attributed).

### SEN-23 · Feed significance sort
Priority: P1 · Labels: frontend, backend · Status: todo

A few days of notable NVD CVEs (CVSS ≥ 7) can push other categories out of the chronological
feed. Add a "most significant" ordering (severity, then time) and per-category quotas.

### SEN-21 · Story clustering over time
Priority: P2 · Labels: analysis · Status: todo

Group related articles and vulnerabilities into evolving "stories" (shared CVE, vendor,
time proximity), without an LLM.
