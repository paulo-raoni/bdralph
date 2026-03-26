# PROGRESS — bdralph

## Status

| Milestone | Status | Gate |
|---|---|---|

## Completed

| Milestone | PR | Gate result |
|---|---|---|
| M0 — Playground + test infrastructure | #3 | ✅ Fixture created, destroyed, recreated deterministically. E2E-01 passes with BDRALPH_E2E_MODE=no-llm. |
| M1a — Base extraction | #5 | ✅ Three loop scripts extracted and adapted. bash -n passes. Smoke test verifies correct paths, SENSITIVE_PATHS, and env vars. |
| M1b — CLI wrapper + base documentation | #7 | ✅ `bdralph "task"` executes end-to-end. CLI smoke tests pass. docs/architecture.md and docs/traces.md created. |
| M2 — Streaming + basic Ink panel | #9, #10 | ✅ Ink panel renders via BDRALPH_INK_UI=1. Worker output streamed via log file. Panel displays iter/max, model, cost, budget, last 10 worker lines. Process group cleanup via setsid + kill -- -PID. 25 tests passing (INK-01..06, T-13..14, PANEL-01..04). |
| M3 — Per-layer traces | #16 | ✅ L1–L4 write traces/lN-iteration-N.json. traces/ cleaned at session start. Worker reads last N L4 traces via BDRALPH_TRACE_HISTORY (default 3). T-TRACE-01..09, T-TRACE-11 pass. |

## Notes

- Repo created and bootstrapped. devcontainer operational.
- Factory frozen at M53 (50 tests passing). Factory PR marking M53 complete still pending — operator must do this before resuming factory work.
