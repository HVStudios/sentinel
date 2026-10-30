# SENTINEL — Backlog

This file is the source of truth for the backlog until it is mirrored into GitHub Issues.
`node scripts/create-github-issues.mjs` creates one issue per `###` entry below. Its
`--dry-run` flag prints the issues instead of creating them. Each entry has an ID, a
priority (P0 = MVP), labels, a status, and acceptance criteria.

Status values: `todo` · `in-progress` · `done (branch)`.

## P0 — MVP

### SEN-01 · Project scaffold, tooling and CI
Priority: P0 · Labels: infra · Status: todo

npm workspaces (`server`, `web`), strict TypeScript, Vitest, GitHub Actions CI running
typecheck, tests and build.

- [ ] `npm install && npm test` passes on a fresh clone
- [ ] CI workflow runs on push and pull_request

### SEN-02 · SQLite store and domain model
Priority: P0 · Labels: backend, data · Status: todo

Nodes, edges, provenance and sources tables using `node:sqlite`. Idempotent upserts,
transactional batch writes, query helpers.

- [ ] Upserting the same batch twice produces identical state
- [ ] Every node has at least one provenance record
- [ ] Unit tests with in-memory DB

### SEN-03 · Ingest CISA KEV
Priority: P0 · Labels: backend, ingestion · Status: todo

Parse the KEV JSON feed into vulnerability, vendor, product and CWE nodes with
reported edges.

- [ ] Parser tested against recorded fixture
- [ ] dateAdded → occurred_at; ransomware use, due date, required action kept

### SEN-04 · NVD enrichment
Priority: P0 · Labels: backend, ingestion · Status: todo

Fetch CVE details (CVSS v3.x/v4, CWE, references, description) for KEV CVEs that lack
them and for recently published CVEs. Respect rate limits.

- [ ] Rate limiter: ≤ 5 req/30 s without key, ≤ 50 with key
- [ ] Parser tested against recorded fixture

### SEN-05 · FIRST EPSS scores
Priority: P0 · Labels: backend, ingestion · Status: todo

Batch-fetch EPSS score and percentile for stored CVEs.

- [ ] Batches of ≤ 100 CVEs; score date kept

### SEN-06 · Geolocated world events (USGS, NASA EONET)
Priority: P0 · Labels: backend, ingestion, geo · Status: todo

- [ ] Coordinates taken verbatim from source; `geo_basis = coordinates`
- [ ] Parsers tested against fixtures

### SEN-07 · News and tech sources (GDELT, Hacker News)
Priority: P0 · Labels: backend, ingestion · Status: todo

- [ ] GDELT publisher country stored as `country` with `geo_basis = publisher_country` (never as event location)
- [ ] HN stories have no geography
- [ ] Source failure is recorded and does not abort the run

### SEN-08 · Relationship inference
Priority: P0 · Labels: backend, analysis · Status: todo

- [ ] CVE-ID mention → inferred edge, confidence 0.95
- [ ] Vendor-name mention → inferred edge, confidence 0.6, with stop-list
- [ ] Inferred edges recomputed each run; reported edges untouched

### SEN-09 · HTTP API
Priority: P0 · Labels: backend, api · Status: todo

Feed, map, timeline, node, graph, sources and ingest endpoints (see ARCHITECTURE.md).

- [ ] Integration tests via Fastify `inject()`
- [ ] Input validation for query params

### SEN-10 · Web shell and world map
Priority: P0 · Labels: frontend, geo · Status: todo

- [ ] Equal Earth map, zoom/pan, points at true coordinates
- [ ] Publisher-country shading labelled as such; unmapped countries reported
- [ ] Click point → opens investigation

### SEN-11 · Event feed with filters
Priority: P0 · Labels: frontend · Status: todo

- [ ] Category toggles, time window, text search
- [ ] KEV / EPSS / CVSS / ransomware badges, source attribution and timestamps

### SEN-12 · Investigation view and relationship graph
Priority: P0 · Labels: frontend, analysis · Status: todo

- [ ] Facts, provenance and timestamps for any node
- [ ] Force graph, reported solid vs inferred dashed with confidence on hover
- [ ] Navigate by clicking graph nodes

### SEN-13 · Timeline
Priority: P0 · Labels: frontend · Status: todo

- [ ] Stacked histogram by type; brush selects time window for map and feed

### SEN-14 · Documentation
Priority: P0 · Labels: docs · Status: todo

- [ ] README: install, ingest, run, test
- [ ] Backlog statuses reflect reality

## P1 — Next

### SEN-15 · Scheduled refresh and ingest status panel
Priority: P1 · Labels: backend, frontend · Status: todo

Optional in-process interval refresh (`SENTINEL_REFRESH_MINUTES`) and a UI panel showing
last run, counts and errors per source.

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

### SEN-21 · Story clustering over time
Priority: P2 · Labels: analysis · Status: todo

Group related articles and vulnerabilities into evolving "stories" (shared CVE, vendor,
time proximity), without an LLM.
