# SENTINEL — Design

The visual world is an **aeronautical chart**, the kind of sectional chart pilots read: a paper sheet,
pale chart water, tan land, a chart-blue title band, and coloured *overprints* whose meaning is fixed.
It came from the product brief: an exploration tool around a world map, not a vulnerability dashboard,
that must make reported facts, inferred links and uncertainty look different.

The world supplies type, palette, density and one signature move. Layout, navigation and controls
are standard web controls.

## Scene and modes

An analyst scanning a world sheet and following leads, in daylight or at night. Like navigation
charts, which come in day, dusk and night palettes, SENTINEL has two:

- **Day chart:** a light printed sheet with a chart-blue title band.
- **Night chart:** the same sheet for low light. Dark navy water, slate land and a near-black band.
  The overprints brighten so they stay readable.

The chart follows the system setting until the viewer picks Day or Night in the header. That choice
is kept in the browser (`localStorage`, `sentinel.theme`). Every colour is a token on `:root`, and
the night palette overrides them under `:root[data-theme='night']`. Both modes are audited by axe in
the e2e suite.

## Overprint semantics (reserved colours)

| Meaning | Treatment | Token |
|---|---|---|
| Reported by a source | solid chart blue line / tag | `--blue` |
| Inferred by SENTINEL | dashed magenta line / tag; opacity follows confidence | `--magenta` |
| Area reported as affected (GDACS) | diagonal hatching, coloured by alert | `ALERT_COLORS` |
| Coverage (who reported a CVE) | blue country outline | `--blue` |
| Stories (clusters SENTINEL built) | dashed magenta ring | `--magenta` |

Blue and magenta carry only these meanings. Do not use them for decoration.

## Symbols

One shape per item type, used the same way in toggles, feed rows, legends and the timeline:

- Vulnerability: filled square, `--c-vuln`
- World event: filled circle, `--c-event` (map points use per-category colours)
- News & tech: triangle, `--c-news`
- Story: dashed magenta ring
- Vendor HQ (Wikidata): blue outlined diamond, filled when selected

## Palette (day; night values in `styles.css`)

Sheet `--paper #f3f4ee` / `--sheet #fff`; ink `--ink #18212b`, secondary `--ink-2 #4f5862`
(≥ 4.5:1 on the sheet). Chart: water `#d3e5ec`, graticule `#a9c8d4`, land `#ebe8cf`, borders `#8d886a`.
Title band `--band #16365f`. Severity tones are darkened for text on a light ground (WCAG AA).

## Type

- UI and reading text: the system sans.
- Labels, headings, degree marks, tab and segment labels: **Barlow Semi Condensed** (self-hosted
  via `@fontsource`), uppercase with 0.06–0.07em tracking for headings, like chart lettering.
- Monospace only for data: CVE IDs, scores, domains.
- Tabular numerals throughout.

## Signature move

The map is framed like a chart sheet: an Equal Earth projection on pale water, with degree labels
(30° steps) printed around its edge. Significant events get a single range ring that widens and fades.
That is the only looping motion, and it is disabled under `prefers-reduced-motion`.

## Layout

The map fills the screen, and the work areas float over it as panels, as in map-analysis tools:

- **Left column:** the **Layers** card (collapsible) above the **Feed**. Each layer's switch sits
  next to its legend and a line on what it shows and does not show.
- **Centre:** the map, with a small view bar (Map / Trends and counts) and zoom controls. Trends
  replaces the map in the same frame.
- **Right:** the **Investigation** panel when an item is open.
- **Bottom:** the **Timeline**, docked across the map area.

The map is padded so that nothing sits on top of it except the view bar and zoom controls.
Under 900px everything stacks in reading order (map, layers, timeline, feed, investigation). The
Layers card starts collapsed there.

The feed is a ruled list with a fixed symbol column. No coloured side stripes, no glows, no emoji or
Unicode glyphs as icons: icons come from `components/Icon.tsx`, 16px line icons with a 1.5 stroke.

## Next

- Clustering of nearby events, with counts.
- Selection lines from the investigation panel to vendor headquarters (solid blue) and reporting
  countries (dashed magenta).
- Timeline playback.
