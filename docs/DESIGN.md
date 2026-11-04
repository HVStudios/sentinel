# SENTINEL — Design

The visual world is an **aeronautical chart**, the kind of sectional chart pilots read: a paper sheet,
pale chart water, tan land, a chart-blue title band, and coloured *overprints* whose meaning is fixed.
It came from the product brief: an exploration tool around a world map, not a vulnerability dashboard,
that must make reported facts, inferred links and uncertainty look different.

The world supplies type, palette, density and one signature move. Layout, navigation and controls
are standard web controls.

## Scene

An analyst at a desk in daylight, scanning a world sheet and following leads. The interface is light
because a chart is a printed sheet. Density is that of a chart: a lot of information, held together
by rules and a strict symbol vocabulary rather than cards.

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

## Palette

Sheet `--paper #fbfbf7` / `--sheet #fff`; ink `--ink #18212b`, secondary `--ink-2 #4f5862`
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

Panels are columns of one sheet, divided by 1px rules. There are no floating cards, except trend
cards, which are separate exhibits. The feed is a ruled list with a fixed symbol column. No coloured
side stripes, no glows, no emoji or Unicode glyphs as icons: icons come from `components/Icon.tsx`,
16px line icons with a 1.5 stroke.
