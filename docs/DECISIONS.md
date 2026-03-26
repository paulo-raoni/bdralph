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
