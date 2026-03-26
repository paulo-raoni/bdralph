# Architecture — bdralph

## Overview

bdralph is a governed agentic loop runner for Claude Code. It wraps Claude Code as a worker process, orchestrating iterative task execution through a multi-layer review pipeline (L1–L4) with cost controls, sensitivity guards, and structured trace output. The operator runs `bdralph "task"` and the loop handles prompt mounting, review, escalation, and shutdown — without requiring knowledge of the internal prompt structure.

## Component map

```
operator
  │
  ▼
bin/bdralph              ← CLI entry point: flag parsing, validation, typo detection
  │
  ▼
src/loop/ralph-loop.sh   ← loop orchestrator: iterations, shutdown, state files
  │
  ├──► worker (claude code)       ← executes the task via claude -p
  │
  ├──► src/loop/llm-delegate.sh   ← delegates review prompts to LLM providers
  │       │
  │       ├──► L1 sensitivity     ← git diff → sensitive path check (bash, no LLM)
  │       ├──► L2 protocol        ← cheap LLM review (openai-cheap / gemini-flash)
  │       ├──► L3 quality         ← standard LLM review (openai-standard / gemini)
  │       └──► L4 governance      ← deep review (opus-level, triggered by escalation)
  │
  └──► src/loop/cost-guard.sh     ← budget enforcement, per-iteration cost tracking
```

## bin/bdralph

Bash entry point installed via `package.json` `bin` field. After `npm install`, `bdralph` is available in PATH.

Accepts:
- First positional argument: task string or path to a task file (required)
- `--max N` — maximum iterations (default: 10)
- `--budget USD` — cost ceiling in USD (default: 0.50)
- `--worker sonnet|opus|auto` — worker model (default: sonnet)
- `--escalate-after N` — auto-escalation threshold (default: 3)
- `--reviewer-mode pipeline|single` — review strategy (default: pipeline)

Includes Levenshtein-based typo detection for unknown flags. Passes `BDRALPH_NO_UI` through to the loop for headless/CI environments.

Calls `src/loop/ralph-loop.sh` with resolved absolute path.

## src/loop/ralph-loop.sh

Main loop orchestrator. Runs the worker (Claude Code) iteratively, pipes output through the L1–L4 review pipeline, enforces cost guard, and writes state files to `artifacts/bdralph/`.

Refer to [docs/loop.md](loop.md) for full detail on flags, environment variables, sensitive paths, and state files.

## src/loop/llm-delegate.sh

Delegates a prompt to an external LLM provider and returns the response. Used by the review pipeline layers (L2, L3, L4) to obtain LLM judgments. Supports provider chains with failover.

Refer to [docs/loop.md](loop.md) for provider chain configuration.

## src/loop/cost-guard.sh

Sourceable bash library for budget enforcement. Tracks accumulated cost per iteration and halts the loop when the budget ceiling is reached. Used by `ralph-loop.sh`.

Refer to [docs/loop.md](loop.md) for cost guard details.

## Review pipeline (L1–L4)

| Layer | Executor | Cost | Responsibility |
|---|---|---|---|
| L1 | bash (no LLM) | zero | Sensitivity check — scans git diff for changes to sensitive paths. Triggers L4 escalation on match. |
| L2 | cheap LLM (openai-cheap / gemini-flash) | low | Protocol review — checks adherence to task constraints and coding standards. |
| L3 | standard LLM (openai-standard / gemini) | medium | Quality review — deeper analysis of correctness, edge cases, and test coverage. |
| L4 | opus-level LLM | high | Governance review — triggered by L1 escalation or repeated L3 revisions. Final authority on sensitive changes. |

## Streaming + Ink panel (M2)

When `BDRALPH_INK_UI=1` is set (the default from `bin/bdralph`), `ralph-loop.sh` spawns an
Ink-based terminal panel (`src/loop/ralph-ink.ts` → `ralph-ink-panel.tsx`) as a background
process. The panel provides real-time loop visibility without interfering with the worker.

### State file protocol

The loop writes state to files named `${UI_STATE_PREFIX}_<key>.txt`, each containing a
single UTF-8 value. The Ink panel polls these files on a 150ms interval:

| File suffix | Content | Example |
|---|---|---|
| `_task.txt` | Task string | `"Add validation to TaskService"` |
| `_iteration.txt` | Current iteration number | `"3"` |
| `_max_iterations.txt` | Max iterations | `"10"` |
| `_worker_mode.txt` | Worker model label | `"sonnet"` |
| `_total_cost.txt` | Accumulated cost USD | `"0.08"` |
| `_worker_state.txt` | `waiting\|active\|done` | `"active"` |

### Worker output streaming

Worker stdout is written to `${UI_STATE_PREFIX}_worker_output.txt`. The panel reads this
file on a 200ms interval and displays the last 10 lines. The line count is fixed at 10 in
M2; dynamic height based on terminal rows is deferred to M6.

### Panel layout

The panel renders iteration/max, worker model, elapsed time, cost/budget, and the worker
output tail inside Ink `<Box>` and `<Text>` components with border styles.

### BDRALPH_NO_UI=1

When `BDRALPH_NO_UI=1` is set, `bin/bdralph` does **not** export `BDRALPH_INK_UI=1`.
The loop skips the Ink renderer and worker stdout goes directly to the terminal.

### Process lifecycle

- The loop spawns the Ink process via `npx tsx ralph-ink.ts "$UI_STATE_PREFIX"`
- The panel polls state files and worker output on intervals
- On loop completion, the loop sends `SIGTERM` to the Ink process
- The panel handles `SIGTERM`/`SIGINT` by restoring the cursor and exiting cleanly
<!-- TODO: M3 — add traces section -->
<!-- TODO: M6 — add Second Mind section -->
