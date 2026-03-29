# Web UI — Design System

## Color palette

| Token | Hex | Usage |
|---|---|---|
| `bg-base` | `#0d1117` | Page background |
| `bg-panel` | `#161b22` | Panel / card background |
| `bg-overlay` | `#1c2128` | Tooltip / dropdown background |
| `bg-subtle` | `#21262d` | Inactive layer, code block background |
| `border-default` | `#30363d` | Default border |
| `border-muted` | `#21262d` | Separator, subtle divider |
| `text-primary` | `#e6edf3` | Primary text |
| `text-secondary` | `#c9d1d9` | Body text, panel content |
| `text-muted` | `#8b949e` | Labels, secondary info |
| `text-disabled` | `#484f58` | Disabled, hint text |
| `green` | `#3fb950` | Success, SHIP, clean, PASS |
| `green-bg` | `#1a7f3733` | Green background fill |
| `green-border` | `#2ea043` | Green border |
| `blue` | `#58a6ff` | In progress, info, Second Mind, active layer |
| `blue-bg` | `#1f6feb33` | Blue background fill |
| `blue-border` | `#1f6feb` | Blue border |
| `amber` | `#e3b341` | Warning, REVISE, fallback, alert |
| `amber-bg` | `#d2992211` | Amber background fill |
| `amber-border` | `#d29922` | Amber border |
| `red` | `#f85149` | Error, crash, BLOCKED, stop now |
| `red-bg` | `#da363322` | Red background fill |
| `red-border` | `#da3633` | Red border |

## Semantic color mapping

| Meaning | Color | Examples |
|---|---|---|
| Success / approved | green | SHIP, PASS, clean, layer done |
| In progress / info | blue | reviewing, active layer, Second Mind |
| Warning / degraded | amber | REVISE, fallback provider, alert bar |
| Error / blocked | red | crash, provider error, BLOCKED |
| Inactive / skipped | `#484f58` on `#21262d` | skipped layers, standby |

## Typography

- Font: `'Courier New', monospace` for all dashboard content
- Font (tooltips, help panel): `sans-serif`
- Base size: `11px` for log lines, labels, body
- Labels / section headers: `9–10px`, uppercase, `letter-spacing: 0.5px`
- Metric values: `17px`, bold
- Logo: `22px`, bold, `#58a6ff`

## Spacing

- Page padding: `16px`
- Panel padding: `10–12px`
- Gap between panels: `10px`
- Gap between metrics: `8px`
- Border radius (panels): `8px`
- Border radius (layer boxes, badges): `5px`
- Border radius (buttons): `4px`
- Border radius (help button): `50%` (circle)

## Component borders

- Default panel: `1px solid #30363d`
- Second Mind panel: `1px solid #1f6feb44`
- Alert bar: `1px solid #d2992255`
- Layer box (done): `1px solid #2ea043`
- Layer box (active): `1px solid #1f6feb`
- Layer box (error): `1px solid #f85149`
- Layer box (warn): `1px solid #d29922`
- Layer box (skip): `1px dashed #484f58`
- Layer box (wait): `1px solid #30363d`
