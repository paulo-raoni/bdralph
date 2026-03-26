# BACKLOG — bdralph

Future ideas and deferred scope. Nothing here is committed until the operator explicitly adopts it as a milestone.

---

## Milestones (ordered by rough priority)

### M1b — CLI wrapper + base documentation
- `bdralph "task" --max 10 --worker sonnet` mounts prompt internally, calls Claude Code via `claude -p --dangerously-skip-permissions`
- `BDRALPH_NO_UI=1` for CI and headless environments
- README with ASCII diagram of the pipeline, link to `docs/`
- `docs/architecture.md` — complete documentation
- `docs/traces.md` — trace system contracts

### M2 — Streaming + basic panel
- Worker redirects stdout in real time, line by line
- Ink panel — current iteration, executor, model, accumulated cost, budget remaining
- `SESSION_ID` unique per session, `SESSION_TOTAL_COST` tracked
- Shutdown status via signal handlers and heartbeat
- Atomic writes for all state files

### M3 — Per-layer traces
- L1–L4 write `traces/lN-iteration-N.json` after each execution
- Worker reads `iteration-log.json` + L4 traces from last N iterations before starting
- Vertical read hierarchy within current iteration

### M4 — Iteration log
- `iteration-log.json` with fields `strategy`, `decision_rationale`, `next_action`
- Worker reads and writes each iteration

### M5 — Contextual L2 + configurable SHIP-ON-FAILURE
- L2 reads L1 trace to distinguish real failure from safety constraint impediment
- SHIP-ON-FAILURE with semantic detection via L2, not hardcoded keywords
- Configurable trigger list in `.bdralph.config.json`

### M6 — Second Mind + complete panel
- Full Ink panel — alerts → Second Mind → loop
- `bdralph ask "question"` operational
- 3 stop modes, 3 activation triggers
- Deterministic watchdog for Gas Town

### M6b — REPL terminal
- `bdralph` with no arguments opens a persistent terminal session
- Internal `>` prompt for task input, flags configurable interactively
- Summary at end of each session (SHIP/BLOCKED + iterations + cost)
- `/clear` — resets loop context, keeps terminal and Second Mind alive
- `exit` or Second Mind command shuts down the terminal
- Alerts and Second Mind remain active between sessions

### M7 — Native Gemini
- `WORKER_PROVIDER=google` works natively, without curl
- Gemini Flash as L2/L3 option
- Cost guard updated with Gemini pricing

### M8 — Gas Town
- Feature flag `BDRALPH_GAS_TOWN=enabled`
- Full flow: JSON declaration → Second Mind validates → parallel loops → watchdog → integration → coherence check
- Budget divided proportionally between loops

---

## Future (no date, no defined order)

- **Panel responsiveness** — adaptive layout, panel collapse, minimalist mode
- **Observability drill-down** — breakdown by layer, history by iteration
- **Codex as executor** — experimental milestone
- **Interactive setup** — `npx bdralph-setup` with guided questions
- **Static server** — landing page, curl install
- **Agnostic mode** — support for other CLIs, community contributions
- **License** — decide before publishing (blocks npm package name decision: `bdralph` vs `bd-ralph`)
- **npm package name** — `bdralph` vs `bd-ralph` — decide when publishing milestone is adopted
- **Mascot** — post-mature project, out of critical path
- **BDRALPH_LOOP_MOCK=1 production guard** — add a warning banner or NODE_ENV-style
  guard to prevent mock mode from activating silently in production environments.
  Identified during M1b review (Finding 2, severity: low).
- **devcontainer PATH / bdralph alias** — after `npm install`, `bdralph` is not available
  directly in the devcontainer PATH (symlink in `node_modules/.bin/` is not created).
  Current workaround: `bash bin/bdralph`. Resolve before or alongside the publishing
  milestone — options: alias in `devcontainer.json`, setup script, or PATH fix.
- **Test parallelism** — as the test suite scales (unit + E2E), CI gates
  will slow down. Two improvements to implement when gates start impacting
  the development cycle:
  (1) Parallel gates: run `npm test`, `npm run typecheck`, and `npm run lint`
  concurrently via bash `&` + `wait` instead of sequentially.
  (2) Vitest worker partitioning: configure `--pool` and `--poolOptions` to
  distribute test files across parallel workers. Expose `BDRALPH_TEST_WORKERS`
  env var so operators can tune concurrency for their environment (default:
  Vitest's own default of `os.cpus().length - 1`). RAM/CPU overhead is real —
  each worker spawns a separate Node process. Benchmark before enabling by
  default.
  Trigger: implement when unit tests approach ~1000 or E2E suite exceeds
  acceptable gate duration.
  Discarded options considered during planning:
  - Layer pipeline overlap (L1 writes trace while L2 starts reading) —
    marginal gain; L1 trace write is fast relative to LLM execution time.
  - Worker implementation parallelism — Claude Code CLI and Codex already
    parallelize independent tool calls natively; bdralph does not need to
    manage this.
