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
| Selection line: open item → vendor HQ (reported link, Wikidata HQ) | solid blue curve, diamond end | `--blue` |
| Selection line: open item → publisher country of an outlet that mentioned it (inferred) | dashed magenta curve, ring end; opacity follows confidence | `--magenta` |

Blue and magenta carry only these meanings. Do not use them for decoration.

## Symbols

One shape per item type, used the same way in toggles, feed rows, legends and the timeline:

- Vulnerability: filled square, `--c-vuln`
- World event: filled circle, `--c-event` (map points use per-category colours)
- News & tech: triangle, `--c-news`
- Story: dashed magenta ring
- Cluster of nearby events: a ring in the event colour (the category colour when all members share one)
  with the count in ink at its centre
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

## Map features

**Clusters.** At the current zoom, event points closer than 16 screen pixels merge into a cluster
(`web/src/lib/clusters.ts`, greedy and deterministic: the most severe event seeds each cluster). Zooming in
splits them; at full zoom nothing merges, and the open item is never merged. Clusters are drawn in screen
pixels (about 20–30px across, so they meet the 24px target size) and sit in the map's single roving focus
with the other markers. Each has an accessible name such as "3 events near Japan (Earthquake: 2, Flood: 1)",
the country under it or rounded coordinates at sea. Click or Enter zooms to fit its members, and keyboard
focus moves to the first of them.

**Selection lines.** While an item is open, curved lines leave a port on the investigation panel's left edge,
level with its heading (`components/SelectionLines.tsx`). Solid blue goes to the Wikidata headquarters of the
vendors whose products a vulnerability affects (`shared/vendorHq.ts`, confident matches only, from the
`vendorHqs` field of the node detail on both the server and the static build). Dashed magenta goes to the
publisher countries of outlets that mentioned the item (`coverageByCountry`). Reported lines bow up and
inferred ones bow down, so two lines to the same country stay apart. An item with source coordinates
connects from its own point instead. Lines run under the floating panels. They are decoration for sighted
users: the **Selection links** layer in the Layers card lists the same links as text, and its switch is
kept in the URL (`off=links`). On a phone the map stays above the open investigation while there are lines
to draw, and they leave from the map's bottom edge.

**Timeline playback.** Play on the docked timeline steps the brushed window forward a quarter of its width
at a time (an eighth of the range if nothing is brushed) until it reaches the end, so events appear in time
order. Step back and Step forward move one step. Dragging the chart or changing the range stops playback, and
a whole run is one browser history entry. Under `prefers-reduced-motion` the brush jumps instead of sliding
and steps come every 2.2s instead of 0.9s. Play, Pause and the end of the run are announced politely.

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

- Show the outlets behind a dashed line on hover or focus of its end (today they are listed in the panel's
  "Who reported it" section).
- Cluster vendor HQ diamonds the same way when many vendors share a city.
