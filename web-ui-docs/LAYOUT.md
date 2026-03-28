# Web UI — Layout

## Page structure (top to bottom)

```
┌─────────────────────────────────────────────────────┐
│ HEADER (2 rows)                                      │
│  row 1: mascot + logo + subtitle | stop buttons + ? │
│  row 2: ● running | task label (truncated)           │
├─────────────────────────────────────────────────────┤
│ HELP PANEL (collapsible, hidden by default)          │
│  tabs: Legend | How it works                        │
├─────────────────────────────────────────────────────┤
│ METRICS (4 columns)                                  │
│  iteration | worker | reviewer cost | elapsed        │
├─────────────────────────────────────────────────────┤
│ ALERT BAR (conditional — only when alerts exist)    │
├─────────────────────────────────────────────────────┤
│ PIPELINE (full width)                               │
│  L1 › L2 › L3 › L4  +  summary row                 │
├──────────────────────────┬──────────────────────────┤
│ WORKER OUTPUT (flex: 1)  │ SECOND MIND (flex: 1)    │
│                          ├──────────────────────────┤
│                          │ ASK SECOND MIND          │
└──────────────────────────┴──────────────────────────┘
```

## Main grid

Two columns, `grid-template-columns: 1fr 360px`, gap `10px`.

Left column: worker output (fills remaining height).
Right column: Second Mind (grows) + ask textarea (fixed at bottom), using `display: flex; flex-direction: column; gap: 10px`.

## Header

Two rows inside a single panel (`background: #161b22`):
- `header-top`: `overflow: hidden` (for border-radius) — logo area + stop buttons + help button
- `header-bottom`: `overflow: visible` (so task tooltip can escape) — badge + task label

## Pipeline

Full-width panel below alert bar, above the two-column grid.
Internal layout: `display: flex; align-items: center; gap: 6px` — four `.layer` blocks with `flex: 1`, separated by `›` arrow characters.
Summary row below layers: `border-top: 1px solid #21262d`, `font-size: 10px`.

## Help panel

Collapses/expands via `max-height` transition (`0` → `700px`).
Opens below `header-top`, above metrics.
Has `×` close button inside the panel header (top right).
`?` button in header-top toggles open/close.

## Tooltips

All tooltips use `position: absolute`, `z-index: 100`, `pointer-events: none`.
- Layer tooltips: appear **above** the layer (`bottom: calc(100% + 6px)`), centered horizontally
- Stop button tooltips: appear **above**, aligned to right
- Task label tooltip: appears **below** (`top: calc(100% + 5px)`), aligned to left
- Header-bottom must have `overflow: visible` for task tooltip to escape

## Responsive notes

The dashboard is designed for desktop browser widths (min ~900px).
No mobile breakpoints required for v1.
Port is `7340` by default.
URL is printed in the terminal on startup — user opens it in any browser.
