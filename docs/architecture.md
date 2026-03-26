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

<!-- TODO: M2 — add streaming and Ink panel section -->
<!-- TODO: M3 — add traces section -->
<!-- TODO: M6 — add Second Mind section -->
