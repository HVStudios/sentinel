# SENTINEL — Backlog

This file is the planning source for the backlog. It is mirrored in
[GitHub Issues](https://github.com/HVStudios/sentinel/issues), where day-to-day status lives.
`node scripts/create-github-issues.mjs` creates one issue per `###` entry below. Its
`--dry-run` flag prints the issues instead of creating them. Each entry has an ID, a
priority (P0 = MVP), labels, a status, and acceptance criteria.

Status values: `todo` · `in-progress` · `done (merged)`.

## P0 — MVP

### SEN-01 · Project scaffold, tooling and CI
Priority: P0 · Labels: infra · Status: done (merged)

npm workspaces (`server`, `web`), strict TypeScript, Vitest, GitHub Actions CI running
typecheck, tests and build.

- [x] `npm install && npm test` passes on a fresh clone
- [x] CI workflow runs on push and pull_request

### SEN-02 · SQLite store and domain model
Priority: P0 · Labels: backend, data · Status: done (merged)

Nodes, edges, provenance and sources tables using `node:sqlite`. Idempotent upserts,
transactional batch writes, query helpers.

- [x] Upserting the same batch twice produces identical state
- [x] Every node has at least one provenance record
- [x] Unit tests with in-memory DB

### SEN-03 · Ingest CISA KEV
Priority: P0 · Labels: backend, ingestion · Status: done (merged)

Parse the KEV JSON feed into vulnerability, vendor, product and CWE nodes with
reported edges.

- [x] Parser tested against recorded fixture
- [x] dateAdded → occurred_at; ransomware use, due date, required action kept

### SEN-04 · NVD enrichment
Priority: P0 · Labels: backend, ingestion · Status: done (merged)

Fetch CVE details (CVSS v3.x/v4, CWE, references, description) for KEV CVEs that lack
them and for recently published CVEs. Respect rate limits.

- [x] Rate limiter: ≤ 5 req/30 s without key, ≤ 50 with key
- [x] Parser tested against recorded fixture

### SEN-05 · FIRST EPSS scores
Priority: P0 · Labels: backend, ingestion · Status: done (merged)

Batch-fetch EPSS score and percentile for stored CVEs.

- [x] Batches of ≤ 100 CVEs; score date kept

### SEN-06 · Geolocated world events (USGS, NASA EONET)
Priority: P0 · Labels: backend, ingestion, geo · Status: done (merged)

- [x] Coordinates taken verbatim from source; `geo_basis = coordinates`
- [x] Parsers tested against fixtures

### SEN-07 · News and tech sources (GDELT, Hacker News)
Priority: P0 · Labels: backend, ingestion · Status: done (merged)

- [x] GDELT publisher country stored as `country` with `geo_basis = publisher_country` (never as event location)
- [x] HN stories have no geography
- [x] Source failure is recorded and does not abort the run

### SEN-08 · Relationship inference
Priority: P0 · Labels: backend, analysis · Status: done (merged)

- [x] CVE-ID mention → inferred edge, confidence 0.95
- [x] Vendor-name mention → inferred edge, confidence 0.6, with stop-list
- [x] Inferred edges recomputed each run; reported edges untouched

### SEN-09 · HTTP API
Priority: P0 · Labels: backend, api · Status: done (merged)

Feed, map, timeline, node, graph, sources and ingest endpoints (see ARCHITECTURE.md).

- [x] Integration tests via Fastify `inject()`
- [x] Input validation for query params

### SEN-10 · Web shell and world map
Priority: P0 · Labels: frontend, geo · Status: done (merged)

- [x] Equal Earth map, zoom/pan, points at true coordinates
- [x] Publisher-country shading labelled as such; unmapped countries reported
- [x] Click point → opens investigation

### SEN-11 · Event feed with filters
Priority: P0 · Labels: frontend · Status: done (merged)

- [x] Category toggles, time window, text search
- [x] KEV / EPSS / CVSS / ransomware badges, source attribution and timestamps

### SEN-12 · Investigation view and relationship graph
Priority: P0 · Labels: frontend, analysis · Status: done (merged)

- [x] Facts, provenance and timestamps for any node
- [x] Force graph, reported solid vs inferred dashed with confidence on hover
- [x] Navigate by clicking graph nodes

### SEN-13 · Timeline
Priority: P0 · Labels: frontend · Status: done (merged)

- [x] Stacked histogram by type; brush selects time window for map and feed

### SEN-14 · Documentation
Priority: P0 · Labels: docs · Status: done (merged)

- [x] README: install, ingest, run, test
- [x] Backlog statuses reflect reality

### SEN-24 · Hosted static site on GitHub Pages
Priority: P0 · Labels: infra, frontend · Status: done (merged)

Make SENTINEL viewable without running it locally. A scheduled GitHub Actions workflow runs
the ingest and exports a JSON snapshot. The web app is built in *static mode*, which answers
the same queries client-side from that snapshot. The result is deployed to GitHub Pages.

- [x] `npm run export` writes a self-contained snapshot (all nodes, edges, provenance, source status)
- [x] Static mode implements feed, map, timeline, node and graph queries client-side, with tests
- [x] Workflow: scheduled refresh, ingest, export, build, deploy to Pages
- [x] UI shows snapshot time and hides the refresh action in static mode
- [x] Pages enabled; live at https://hvstudios.github.io/sentinel/

## P1 — Next

### SEN-15 · Scheduled refresh and ingest status panel
Priority: P1 · Labels: backend, frontend · Status: in-progress

Optional in-process interval refresh (`SENTINEL_REFRESH_MINUTES`) and a UI panel showing
last run, counts and errors per source.

- [x] Sources panel with last run, status, count and error; manual "Refresh all sources" (feature/sen-05-web)
- [ ] Interval refresh via `SENTINEL_REFRESH_MINUTES`
- [ ] Poll ingest status while running and refresh map and feed when it finishes

### SEN-16 · Vendor headquarters geography (Wikidata, attributed)
Priority: P1 · Labels: geo, data · Status: done (merged)

Resolve vendor → Wikidata entity → headquarters, show it on the map as "vendor HQ (Wikidata)".
Never place a vulnerability itself on the map.

- [x] `wikidata-vendors` source: name + variant lookup over SPARQL, candidates must be described as technology organisations
- [x] Resolution rules (single candidate → exact label → shared HQ → otherwise ambiguous); identity stored as inferred with confidence (exact label 0.8, name variant 0.7, alias 0.55)
- [x] Only label matches (≥ 0.7) are mapped; alias matches are shown in the investigation as possible matches
- [x] Bounded runtime (2-minute budget, no retries, most-affected vendors first); database cached between Pages runs so lookups accumulate and refresh every 30 days
- [x] Map layer: diamonds for vendors behind vulnerabilities in the window, sized by count, with legend and toggle; same layer in the static build (parity-tested)

### SEN-17 · End-to-end tests (Playwright)
Priority: P1 · Labels: testing · Status: done (merged)

- [x] Offline seeded database from the shared fixture router; frozen browser clock
- [x] Same specs against the live server and the static Pages build (`/sentinel/`)
- [x] Flows: load without console errors, filters and search, feed order, investigation → graph → product → vendor → back, deep link, map point, vendor HQ, timeline brush, Sources panel
- [x] CI job with report artifact on failure

### SEN-18 · Additional sources
Priority: P1 · Labels: ingestion · Status: done (merged)

- [x] CISA cybersecurity advisories (delivered with the curated feeds in SEN-22)
- [x] GDACS disaster alerts: Orange/Red of all types + Green cyclones/volcanoes; enrich matching USGS quakes and EONET storms instead of duplicating; centroids labelled; multi-country events not reduced to a point
- [x] GitHub Security Advisories: reviewed high/critical, CVE enrichment or `ghsa:` nodes, package nodes with version ranges and fixes, GHSA-ID mention inference
- [x] EPSS skips non-CVE advisories; e2e coverage for both sources

### SEN-19 · Watchlists and saved investigations
Priority: P1 · Labels: frontend, backend · Status: todo

Track vendors, products or CVEs locally and highlight new related items.

### SEN-20 · Accessibility and responsive layout pass
Priority: P1 · Labels: frontend, a11y · Status: done (merged)

- [x] Automated WCAG 2.2 A/AA audit (axe-core) of main view, investigation and Sources dialog in both builds: zero violations
- [x] Map and graph: group roles (were images containing buttons), one Tab stop each with arrow-key navigation, Enter to open, focus shows the hover tooltip, visible SVG focus styles
- [x] Map zoom buttons (+, −, reset) and keyboard shortcuts
- [x] Accessible names start with the visible label (WCAG 2.5.3); the current graph node is not a button
- [x] Focus management: skip link, focus moves to the opened item's heading, Escape closes and returns focus (including to SVG markers), modal Sources dialog with focus trap
- [x] Time presets expose their pressed state
- [x] Contrast verified: every text colour ≥ 5.1:1 on every background
- [x] Phone layout: page scrolls with natural section heights (the map used to collapse to a strip at 375 px); e2e asserts map size and no horizontal scroll

### SEN-22 · Reliable news source with publisher country
Priority: P1 · Labels: ingestion, geo · Status: done (merged)

GDELT DOC 2.0 returned HTTP 429 or empty results for most requests, locally and on GitHub
Actions runners, so it stays best-effort.

- [x] Curated RSS/Atom feed registry (17 feeds: security news, government advisories, tech/AI) with the publisher country and a reference per outlet
- [x] Items without date or link dropped, 30-day window, deduplicated with GDELT by URL
- [x] Per-feed failures reported as source warnings; GDELT partial failures too
- [x] Tech-feed items classified by headline (security / AI / tech)
- [x] Investigation panel shows the outlet, publisher country and its reference

### SEN-23 · Feed significance sort
Priority: P1 · Labels: frontend, backend · Status: done (merged)

A few days of notable NVD CVEs (CVSS ≥ 7) pushed other categories out of the chronological feed.

- [x] Feed orderings `mixed` (default; one category at a time, newest first), `latest` and `top` (one category at a time, by rank)
- [x] Explained article rank (category, HN points, mentions of KEV-listed or known CVEs), shown as "SENTINEL rank"
- [x] KEV-listed CVEs always outrank unexploited ones
- [x] Same behaviour in the static (Pages) build, covered by the parity test

### SEN-25 · Merge duplicate vendor nodes
Priority: P1 · Labels: data · Status: done (merged)

KEV names vendors readably ("Palo Alto Networks", "D-Link"), while NVD CPE IDs run them together
("paloaltonetworks", "dlink") or add suffixes ("zohocorp", "sudo_project"), creating two vendor
nodes for one company.

- [x] Rule 1 (exact): names identical once separators are removed are merged
- [x] Rule 2 (suffix): names differing only by a trailing legal/descriptive word are merged, only into a single KEV-named vendor; no prefix matching
- [x] Products move under the surviving vendor; same-named products merge (e.g. "Pan Os" + "PAN-OS")
- [x] The KEV spelling survives; other spellings are kept in `attrs.aliases` with their rule and shown as "Also known as"
- [x] Runs after every source that writes vendors, so Wikidata and the graph see one node per company; idempotent

### SEN-21 · Story clustering over time
Priority: P2 · Labels: analysis · Status: todo

Group related articles and vulnerabilities into evolving "stories" (shared CVE, vendor,
time proximity), without an LLM.
