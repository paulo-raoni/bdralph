# Traces — bdralph

## Purpose

Traces are structured records of what happened during a loop execution. They provide observability into each iteration's decisions, review outcomes, and cost — enabling post-hoc analysis, debugging, and operator oversight without requiring real-time monitoring.

## Current state (M1b)

No trace files yet. The loop writes `work-summary.txt` and `work-complete.txt` to `artifacts/bdralph/`. These are the only structured outputs from the loop at this milestone.

## work-summary.txt

- **Format:** plain text, one summary block per iteration
- **Location:** `artifacts/bdralph/work-summary.txt`
- **Lifecycle:** created at loop start, appended after each iteration, persists until the next loop execution overwrites it
- **Contents:** iteration number, worker model used, review outcome (SHIP/REVISE/BLOCKED), accumulated cost

## work-complete.txt

- **Format:** plain text, single file written at loop completion
- **Location:** `artifacts/bdralph/work-complete.txt`
- **Lifecycle:** written once when the loop exits (either SHIPPED or BLOCKED), not appended
- **Contents:** final status (SHIPPED or BLOCKED), total iterations, total cost, timestamp

<!-- TODO: M3 — L1–L4 per-layer trace files (traces/lN-iteration-N.json) -->
<!-- TODO: M4 — iteration-log.json fields and schema -->
