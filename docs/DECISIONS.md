# DECISIONS — bdralph

Index of key design decisions. One line per decision. For full detail, see `docs/decisions/MN.md`.

---

## M0 — Planning session

| ID | Decision | Detail |
|---|---|---|
| M0-01 | Trace system: vertical hierarchy within current iteration, worker reads L4 history | docs/decisions/M0.md |
| M0-02 | iteration-log fields: strategy, decision_rationale, next_action | docs/decisions/M0.md |
| M0-03 | iteration-log discarded fields: quality_score, alternatives_considered | docs/decisions/M0.md |
| M0-04 | Bidirectional interface: operator-signal.json, verified per iteration | docs/decisions/M0.md |
| M0-05 | Shutdown: 5 statuses, 5s/30s heartbeat, atomic write via .tmp | docs/decisions/M0.md |
| M0-06 | CLI wrapper: bdralph mounts prompt, Claude Code headless via --dangerously-skip-permissions | docs/decisions/M0.md |
| M0-07 | Panel layout: alerts → Second Mind → loop (fixed order), 3 breakpoints | docs/decisions/M0.md |
| M0-08 | Second Mind: on-demand, 3 triggers, bdralph ask via operator-signal | docs/decisions/M0.md |
| M0-09 | Gas Town: BDRALPH_GAS_TOWN=enabled opt-in, bash watchdog, isolated worker | docs/decisions/M0.md |
| M0-10 | Agnostic mode: executor CLI, not LLM via API directly | docs/decisions/M0.md |
| M0-11 | Continuous Awareness Mode: discarded (Second Mind is not an active sentinel) | docs/decisions/M0.md |
| M0-12 | Playground: internal fixture, not external repo | docs/decisions/M0.md |
| M0-13 | Sensitive paths: CLAUDE.md, docs/PROGRESS.md, docs/BACKLOG.md, docs/DECISIONS.md, docs/decisions/, .githooks/ | docs/decisions/M0.md |
| M0-14 | Provider chain env vars use BDRALPH_ prefix (not RALPH_) | docs/decisions/M0.md |
| M0-15 | Branch naming convention: feat/mN-description, fix/, chore/, doc/, bootstrap/ | docs/decisions/M0.md |
| M0-16 | Governance files moved to docs/ — CLAUDE.md and README.md stay at root | docs/decisions/M0.md |
| M0-17 | Executor invocation contract: --dangerously-skip-permissions for Claude Code, --dangerously-bypass-approvals-and-sandbox for Codex, Always proceed for Antigravity | docs/decisions/M0.md |

## M1b — CLI wrapper + base documentation

| ID | Decision | Detail |
|---|---|---|
| M1b-01 | Entry point: bin field | docs/decisions/M1b.md |
| M1b-02 | Typo detection in bash | docs/decisions/M1b.md |
| M1b-03 | Docs: structured placeholders with real content | docs/decisions/M1b.md |
| M1b-04 | Session termination: summary output | docs/decisions/M1b.md |
| M1b-05 | REPL terminal deferred to M6b | docs/decisions/M1b.md |
| M1b-06 | BDRALPH_LOOP_MOCK=1 for testing | docs/decisions/M1b.md |

## M2 — Streaming + basic panel

| ID | Decision | Detail |
|---|---|---|
| M2-01 | Streaming transport: log file + tail (UI_WORKER_OUTPUT_FILE, 200ms poll) | docs/decisions/M2.md |
| M2-02 | Panel fields: iteration/max, worker model, cost + budget, last 10 worker lines | docs/decisions/M2.md |
| M2-03 | BDRALPH_NO_UI=1: panel does not start, worker stdout direct to terminal | docs/decisions/M2.md |
| M2-04 | Streaming line count: N=10 fixed in M2, dynamic height deferred to M6 | docs/decisions/M2.md |

## M3 — Per-layer traces

| ID | Decision | Detail |
|---|---|---|
| M3-01 | Trace schema: common fields + L1 extras (sensitive_paths_matched, files_checked, escalated_to_l4) + L4 extras (triggered_by, consecutive_revises_at_trigger, l1_escalated) | docs/decisions/M3.md |
| M3-02 | Trace location: artifacts/bdralph/traces/ (flat directory) | docs/decisions/M3.md |
| M3-03 | Trace naming: lN-iteration-N.json (e.g. l1-iteration-3.json) | docs/decisions/M3.md |
| M3-04 | Trace cleanup: traces/ deleted at session start | docs/decisions/M3.md |
| M3-05 | Worker trace history: BDRALPH_TRACE_HISTORY env var, default 3 | docs/decisions/M3.md |

## M4 — Iteration log

| ID | Decision | Detail |
|---|---|---|
| M4-01 | Iteration log schema: session_id, iteration, strategy, decision_rationale, next_action | docs/decisions/M4.md |
| M4-02 | Location: artifacts/bdralph/iteration-log.json (single file, overwritten each iteration) | docs/decisions/M4.md |
| M4-03 | Cleanup: deleted at session start. Persistence between sessions requires M6b session continuation — do not implement without CLI support | docs/decisions/M4.md |
| M4-04 | Writer: the worker, at end of each iteration, before review pipeline | docs/decisions/M4.md |
| M4-05 | Reader: the worker, at start of each iteration. Loop passes path, does not interpret contents | docs/decisions/M4.md |

## M5 — Contextual L2 + configurable SHIP-ON-FAILURE

| ID | Decision | Detail |
|---|---|---|
| M5-01 | L2 classifies worker outcome as failure / safety_impediment / pass via worker_outcome_classification field in L2 trace | docs/decisions/M5.md |
| M5-02 | L2 context: diff + L1 trace + last N lines of worker stdout | docs/decisions/M5.md |
| M5-03 | SHIP-ON-FAILURE: opt-in via .bdralph.config.json, enabled: false by default | docs/decisions/M5.md |
| M5-04 | Triggers: semantic list evaluated by L2, not keyword matching | docs/decisions/M5.md |
| M5-05 | Absent .bdralph.config.json: equivalent to enabled: false, no error | docs/decisions/M5.md |
| M5-06 | SHIP-ON-FAILURE fires only when: config enabled + L2 classifies as failure + triggers satisfied | docs/decisions/M5.md |

## M6 — Second Mind + complete panel

| ID | Decision | Detail |
|---|---|---|
| M6-01 | Stop modes: bdralph stop --now / --after-this / --on-fail writes to operator-signal.json | docs/decisions/M6.md |
| M6-02 | Second Mind triggers: explicit (bdralph ask) + iteration threshold (floor(max/2), BDRALPH_SM_THRESHOLD) + L4 signal (N consecutive REVISEs) | docs/decisions/M6.md |
| M6-03 | bdralph ask is provisional — M6b REPL replaces it with direct interaction | docs/decisions/M6.md |
| M6-04 | Second Mind context: full session (traces + iteration-log + worker output). Worker remains isolated. | docs/decisions/M6.md |
| M6-05 | Second Mind response: artifacts/bdralph/second-mind-response.txt, overwritten on each activation | docs/decisions/M6.md |
| M6-06 | Complete panel: alerts → Second Mind → loop, all 3 breakpoints (M0-07), delivered in M6 | docs/decisions/M6.md |

## M6b — REPL terminal

| ID | Decision | Detail |
|---|---|---|
| M6b-01 | REPL mode: no args → opens REPL, no flag required | docs/decisions/M6b.md |
| M6b-02 | Second Mind persists across /clear cycles. exit shuts down everything | docs/decisions/M6b.md |
| M6b-03 | /set without args shows state + options. Tab completion for flags and values | docs/decisions/M6b.md |
| M6b-04 | Executor terminal during execution: read-only + /stop and /set only. Second Mind acknowledges control commands | docs/decisions/M6b.md |
| M6b-05 | /btw discarded — Second Mind operates exclusively in its panel section | docs/decisions/M6b.md |
| M6b-06 | bdralph ask standalone: legitimate, Second Mind with limited context | docs/decisions/M6b.md |
| M6b-07 | REPL prompt: no prefix = task. Second Mind interaction in its panel section only | docs/decisions/M6b.md |

## M7 — Native Gemini

| ID | Decision | Detail |
|---|---|---|
| M7-01 | Native Gemini: src/loop/providers/gemini.ts via @google/generative-ai SDK, delegated from llm-delegate.sh via npx tsx | docs/decisions/M7.md |
| M7-02 | Provider chain defaults unchanged — WORKER_PROVIDER=google opt-in | docs/decisions/M7.md |
| M7-03 | Gemini pricing: BDRALPH_GEMINI_INPUT/OUTPUT_PRICE env vars, defaults hardcoded at milestone release | docs/decisions/M7.md |

## M8 — Gas Town

| ID | Decision | Detail |
|---|---|---|
| M8-01 | Feature flag: BDRALPH_GAS_TOWN=enabled required, off by default | docs/decisions/M8.md |
| M8-02 | Loop declaration schema: loops[] with id/task/worktree/budget_fraction + integration_task + budget_reserve_fraction | docs/decisions/M8.md |
| M8-03 | Worktrees: created before loops, removed after successful integration, persist on failure | docs/decisions/M8.md |
| M8-04 | Watchdog: conflict pauses newer loop + notifies SM; crash marks failed + continues others; no-progress notifies SM | docs/decisions/M8.md |
| M8-05 | Watchdog behavior open to revision after first real Gas Town execution | docs/decisions/M8.md |
