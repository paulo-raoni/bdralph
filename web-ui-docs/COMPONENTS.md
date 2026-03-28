# Web UI — Components

## Header

### Row 1 (header-top)
- **Mascot**: SVG robot, blue/white, 34×34px. Body `#1f6feb`, stroke `#58a6ff`, eyes `#e6edf3` with blue glow, chest panel with green/blue/amber indicators.
- **Logo**: `bdralph` in `#58a6ff`, `22px bold`. Subtitle `governed agentic loops` in `#484f58`, `9px uppercase`.
- **Stop buttons** (right side):
  - `stop after this` — `background: #d2992211`, `border: 1px solid #d29922`, `color: #e3b341`, `font-size: 11px`, `padding: 4px 12px`
  - `■ stop now` — `background: #da363322`, `border: 1px solid #f85149`, `color: #f85149`
  - Both have tooltips on hover (see tooltip specs below)
- **Help button** (`?`): circle `26×26px`, `border: 1px solid #30363d`, `color: #8b949e`. Active/hover: `border-color: #58a6ff`, `color: #58a6ff`. Toggles help panel.

### Row 2 (header-bottom)
- **`● running` badge**: `background: #1a7f3733`, `border: 1px solid #2ea043`, `color: #3fb950`, `font-size: 9px`
- **Task label**: `font-size: 11px`, `color: #8b949e`, `text-overflow: ellipsis`, `white-space: nowrap`. Tooltip on hover shows full text.

### Stop button tooltips
- `stop after this`: "Completes the current iteration then stops. / Work from this iteration is preserved."
- `■ stop now`: "Stops the loop immediately. / Current iteration is interrupted."

---

## Help panel

Collapsible panel, hidden by default. Opens below header, above metrics.

### Header
- Tabs: **Legend** | **How it works** — `font-size: 10px`, uppercase, `letter-spacing: 0.5px`
- Active tab: `color: #58a6ff`, `border-bottom: 2px solid #58a6ff`
- `×` close button: circle `22×22px`, hover: `border-color: #f85149`, `color: #f85149`

### Legend tab
8 items in a 2-column grid:

| Badge | Label | Description |
|---|---|---|
| `L1` green | Sensitivity check | Detects sensitive files modified. Escalates to L4. |
| `L2` green | Protocol review | Verifies protocol compliance. Result: pass / failure. |
| `L3` blue | Quality review | Evaluates work quality. Emits SHIP or REVISE. |
| `L4` gray | Governance review | Final compliance review. Triggered by L1 or consecutive REVISEs. |
| `SHIP` green | Approved | Work approved. Loop exits successfully. |
| `REVISE` amber | Revision needed | Worker receives feedback and retries next iteration. |
| `BLOCKED` red | Blocked | Max iterations reached without SHIP. |
| `Second Mind` blue | Contextual advisor | Analyzes the loop state and suggests direction. |

### How it works tab
- Iteration flow diagram (operator → worker → L1 → L2 → L3 → SHIP, with REVISE looping back)
- Second Mind flow diagram (bdralph ask → Second Mind → response in panel)
- Quick commands section
- Useful variables section
- All text in English, `font-family: sans-serif`, `font-size: 11px`

---

## Metrics

4-column grid, `gap: 8px`. Each card: `background: #161b22`, `border: 1px solid #30363d`, `border-radius: 6px`, `padding: 8px 12px`.

| Card | Label | Value color |
|---|---|---|
| Iteration | `ITERATION` | `#58a6ff` |
| Worker | `WORKER` | `#e6edf3` (default) |
| Reviewer cost | `REVIEWER COST` | `#3fb950` |
| Elapsed | `ELAPSED` | `#d29922` |

Label: `9px`, uppercase, `color: #8b949e`. Value: `17px`, bold.

---

## Alert bar

Only renders when alerts exist. `background: #d2992211`, `border: 1px solid #d2992255`, `border-radius: 6px`, `padding: 7px 12px`, `font-size: 11px`, `color: #e3b341`.
Prefix: `⚠` symbol.

---

## Pipeline

Full-width panel. Internal layout: flex row, 4 layers + 3 arrows.

### Layer box states

| State | Background | Border | Text color |
|---|---|---|---|
| `done` | `#1a7f3733` | `1px solid #2ea043` | `#3fb950` |
| `active` | `#1f6feb33` | `1px solid #1f6feb` | `#58a6ff` |
| `wait` | `#21262d` | `1px solid #30363d` | `#484f58` |
| `error` | `#da363322` | `1px solid #f85149` | `#f85149` |
| `warn` | `#d2992222` | `1px solid #d29922` | `#e3b341` |
| `skip` | `#21262d` | `1px dashed #484f58` | `#484f58` |

### Layer tooltip content
Each layer tooltip shows: **name + description**, provider, result, cost.
- L1: provider `bash (zero cost)`, result `clean` / `sensitive`
- L2: provider from config (e.g. `openai-cheap · gpt-5.4-nano`), result `PASS` / `FAIL`
- L3: provider from config (e.g. `openai-standard · gpt-5.4-mini`), result `SHIP` / `REVISE` / `in progress...`
- L4: provider from config, result `not triggered` / `SHIP` / `REVISE`

### Summary row
`border-top: 1px solid #21262d`, `font-size: 10px`, `color: #8b949e`, flex row with `gap: 12px`.
Format: `L1: clean · L2: PASS openai-cheap · L3: reviewing openai-standard · layers cost: $0.0008`

---

## Worker output

Left column panel. Fills remaining height (`flex: 1`).
Header: `WORKER OUTPUT` label + `live` badge in `#484f58`.
Body: log lines, `font-size: 11px`, `line-height: 1.65`, `font-family: 'Courier New', monospace`.

### Log line prefix colors
| Prefix | Color | Meaning |
|---|---|---|
| `›` green | `#3fb950` | Normal output |
| `›` blue | `#58a6ff` | Info / notable event |
| `✗` red | `#f85149` | Error line |
| `⚠` amber | `#e3b341` | Warning line |

---

## Second Mind

Right column, upper section (`flex: 1`).
Panel border: `1px solid #1f6feb44`. Header background: `#1f6feb0a`.
Header: blue dot + `SECOND MIND` label + response count (right aligned, `#484f58`).

Each message bubble: `background: #1f6feb0a`, `border: 1px solid #1f6feb1a`, `border-radius: 5px`, `padding: 8px 10px`.
Trigger line: `font-size: 9px`, `color: #484f58`, above message text.

---

## Ask Second Mind

Right column, bottom section (`flex-shrink: 0`).
Label: `ASK SECOND MIND`, `9px`, uppercase, `#8b949e`.
Textarea: `background: #0d1117`, `border: 1px solid #30363d`, `min-height: 86px`, `font-size: 12px`, monospace. Focus: `border-color: #1f6feb88`.
Footer: hint text (`enter · shift+enter new line`) left, `ask ›` button right.
`ask ›` button: `background: #1f6feb22`, `border: 1px solid #1f6feb`, `color: #58a6ff`.
Behavior: Enter sends, Shift+Enter inserts newline.
