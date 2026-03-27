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
| M4 — Iteration log | #17 | ✅ Worker writes/reads iteration-log.json each iteration. Cleaned at session start. Loop passes path, does not interpret contents. T-ITER-01..05 pass. |
| chore: pending items pre-M5 | #18 | ✅ lint gate activated (removed \|\| true), T-TRACE-10 in EDGE_CASES.md, 4 learnings added (L-PROMPT-11, L-TEST-08, L-PR-12, L-BASH-08), RALPH_DIR tech debt in BACKLOG. |
| M5 — Contextual L2 + SHIP-ON-FAILURE | #19 | ✅ L2 receives git diff + L1 trace + worker stdout tail. Classifies worker outcome as pass/failure/safety_impediment in L2 trace. SHIP-ON-FAILURE opt-in via .bdralph.config.json, semantic trigger evaluation via L2. T-M5-01..07 pass. |
| M6a — bdralph stop + Second Mind | #20 | ✅ bdralph stop (--now/--after-this/--on-fail) and bdralph ask write to operator-signal.json. Loop reads signal at iteration start. Second Mind activates on 3 triggers (explicit, threshold, L4 consecutive REVISEs). T-M6A-01..10 pass. |
| M6b-panel — Complete panel layout | #21 | ✅ Ink panel extended with Second Mind section (reads second-mind-response.txt), alerts section, dynamic worker lines count based on terminal rows, 4 width/height breakpoints. INK-07..11 pass. |
| M7 — Native Gemini SDK | #22 | ✅ src/loop/providers/gemini.ts via @google/generative-ai SDK. llm-delegate.sh delegates gemini-sdk provider to gemini.ts via npx tsx. BDRALPH_GEMINI_INPUT/OUTPUT_PRICE env vars. T-GEMINI-01..02 pass. |
| chore: validation tests + reorganization | #23 | ✅ Test dirs reorganized from milestone-based to architecture-based (loop/, panel/). 7 new tests: panel responsiveness (PANEL-R-01..04), BLOCKED path (T-BLOCKED-01..02), bdralph ask without loop (T-CLI-ASK-01). 71 tests passing (11 files). |
| fix: CLASSIFICATION feedback leak + ls pipefail | #24 | ✅ sed '/^CLASSIFICATION:/d' added to FEEDBACK_TEXT pipeline — strips L2 metadata before writing review-feedback.txt. ls glob wrapped in { ... \|\| true; } to prevent exit 2 under pipefail. T-BLOCKED-01 updated to --max 2. |
| docs: PROGRESS + LEARNINGS M5–M7 | #25 | ✅ PROGRESS and LEARNINGS updated through M7. |
| fix: devcontainer PATH, /dev/tty guard, L2 git diff | #26 | ✅ BUG-01 (node_modules/.bin PATH), BUG-02 (/dev/tty ENXIO guard), BUG-04 (L2 git diff main...HEAD). 11 new tests (T-BUG01, T-UI-01..05, PANEL-05, T-INK-CONTENT-01..03, T-M5-08). 82 tests passing. |
| fix: replace node_modules/.bin PATH hack with npm link | #27 | ✅ BUG-05: npm link replaces incorrect PATH manipulation in setup.sh. T-BUG01 updated to verify PATH via which. 82 tests passing. |
| fix: resolve symlink + shellcheck warnings | #28 | ✅ BUG-06: readlink -f in bin/bdralph fixes SCRIPT_DIR when invoked via npm link symlink. Shellcheck lint gate now exits 0 (zero warnings). T-BUG06 added. L-BASH-11 documented. 83 tests passing. |
| docs: complete README | #29 | ✅ README rewritten from scratch: table of contents, status, quick start, CLI reference, Mermaid diagrams (component map, pipeline, SHIP-ON-FAILURE, Second Mind), env vars, providers, project structure, runtime output, known issues. |
| docs: PROGRESS + LEARNINGS — post manual testing | #30 | ✅ Added PRs #25–#29 to Completed table. Added manual testing session notes (T-MAN-01..04). Added L-DEV-02 to LEARNINGS. `npm run typecheck` ✅. |
| fix(loop): BDRALPH_RALPH_DIR and BDRALPH_LOGS_DIR env overrides | #31 | ✅ `RALPH_DIR` and `LOGS_DIR` now read from `BDRALPH_RALPH_DIR` / `BDRALPH_LOGS_DIR` env vars with original values as defaults. Enables per-test tmpDir isolation. `npm test` ✅ (83), `npm run lint` ✅, `npm run typecheck` ✅. |
| feat(e2e): E2E Nível 1 — headless mock loop tests | #32 | ✅ 10 E2E headless tests covering SHIP, BLOCKED, stop controls, Second Mind, L1 escalation, SHIP-ON-FAILURE, session cleanup, traces, cost guard. 3 spec corrections applied by executor. E2E-L1-08 confirmed stale-signal cleanup already exists. `npm test` ✅ (83), `npm run test:e2e:headless` ✅ (10), `npm run lint` ✅, `npm run typecheck` ✅. |

## Notes

- Repo created and bootstrapped. devcontainer operational.
- Factory frozen at M53 (50 tests passing). Factory PR marking M53 complete still pending — operator must do this before resuming factory work.
- Manual testing session completed (partial): T-MAN-01 ✅, T-MAN-02 ✅ (SHIP in 2 iterations, $0.000362 reviewer cost), T-MAN-03 ❌ (Ink panel blocked by devcontainer /dev/tty), T-MAN-04 ⚠️ (stop signal timing inconclusive — now covered by E2E-L1-03/04). Bugs found and fixed in PRs #26–#28.
- E2E Nível 1 complete (PR #32). Stop controls, Second Mind threshold, L1 escalation, SHIP-ON-FAILURE, session cleanup, traces, and cost guard all covered by automated headless tests. `npm run test:e2e:headless` is now a mandatory gate for PRs touching `src/loop/`, `bin/bdralph`, or `tests/`.
