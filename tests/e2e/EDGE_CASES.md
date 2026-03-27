# Edge Cases — bdralph E2E

All edge cases are `not implemented` until the corresponding milestone ships.

---

## Environment and setup (6)

| ID | Case | Status |
|---|---|---|
| ENV-01 | Claude Code not installed — clear error message with install instructions | automated (T-11) |
| ENV-02 | No Claude Code authentication — clear error message | not implemented |
| ENV-03 | Incompatible Node version — fails fast with version requirement | not implemented |
| ENV-04 | `.bdralph.config.json` absent — uses defaults, does not crash | not implemented |
| ENV-05 | Invalid API key — provider error propagated clearly | not implemented |
| ENV-06 | Budget zeroed before start — fails fast with clear message | automated (T-12) |

---

## Loop execution (7)

| ID | Case | Status |
|---|---|---|
| LOOP-01 | Completion signal absent after max iterations — BLOCKED status, improvement suggestion written | automated (T-BLOCKED-01) |
| LOOP-02 | Completion signal file empty — treated as not complete | not implemented |
| LOOP-03 | Diff gigantic (>500 files) — L3 escalates to L4 | not implemented |
| LOOP-04 | Internal infinite loop in worker — max iterations reached, BLOCKED | not implemented |
| LOOP-05 | Worker destroys test environment — afterAll cleanup still runs | not implemented |
| LOOP-06 | Max iterations reached without SHIP — improvement suggestion written | automated (T-BLOCKED-02) |
| LOOP-07 | Same approach repeated N times — worker reads L4 history, breaks pattern | not implemented |

---

## Layer pipeline (7)

| ID | Case | Status |
|---|---|---|
| PIPE-01 | L1 fails (git unavailable) — WARN, L2 proceeds with degraded context | not implemented |
| PIPE-02 | L2 timeout — degraded to single review | not implemented |
| PIPE-03 | L3 contradicts L2 — L3 wins, feedback consolidated | not implemented |
| PIPE-04 | L4 REVISE without explanation — feedback contains "[L4 no explanation]" | not implemented |
| PIPE-05 | L4 REVISE N times on the same point — operator notified, loop continues | not implemented |
| PIPE-06 | SHIP-ON-FAILURE false positive — negated phrase not treated as failure | not implemented |
| PIPE-07 | Corrupted trace file — layer operates without it, logs warning | not implemented |

---

## Filesystem and git (6)

| ID | Case | Status |
|---|---|---|
| GIT-01 | Fixture not created by beforeAll — clear error, test fails fast | not implemented |
| GIT-02 | Dirty fixture from previous test — afterAll cleanup mandatory | not implemented |
| GIT-03 | Worker commits to wrong branch — L1 detects, L4 reviews | not implemented |
| GIT-04 | Worker accidentally pushes — pre-push hook blocks | not implemented |
| GIT-05 | Merge conflict in fixture — worker reports impediment, does not crash | not implemented |
| GIT-06 | Governance file in fixture — loop recognizes safety constraint, signals operator (E2E-06) | not implemented |

---

## Cost and budget (4)

| ID | Case | Status |
|---|---|---|
| COST-01 | Cost guard triggers mid-iteration — graceful stop, partial report | not implemented |
| COST-02 | Estimate far below real cost — worker completes, cost guard records real cost | not implemented |
| COST-03 | Provider changes pricing — cost guard uses configured price, not live price | not implemented |
| COST-04 | Two Gas Town loops competing for budget — proportional split enforced at start | not implemented |

---

## Shutdown and recovery (5)

| ID | Case | Status |
|---|---|---|
| SHUT-01 | SIGINT during trace write — atomic write ensures no corruption | not implemented |
| SHUT-02 | Crash during iteration-log write — last heartbeat used for partial report | not implemented |
| SHUT-03 | Heartbeat stopped but process alive — not declared as crash until 30s threshold | not implemented |
| SHUT-04 | Loop restarted after crash — reads last heartbeat, continues from last complete iteration | not implemented |
| SHUT-05 | Two processes against same fixture — second process detects lock, refuses to start | not implemented |

---

## Second Mind and Gas Town (5)

| ID | Case | Status |
|---|---|---|
| SM-01 | `bdralph ask` without Second Mind active — clear error message | automated (T-CLI-ASK-01) — documents current behavior: no warning when loop not active |
| SM-02 | Second Mind timeout — operator notified, loop continues | not implemented |
| SM-03 | Watchdog detects conflict with Second Mind busy — conflict queued, not dropped | not implemented |
| SM-04 | Gas Town without feature flag — clear error with `BDRALPH_GAS_TOWN=enabled` instruction | not implemented |
| SM-05 | Integration ralph fails — Second Mind does coherence check on partial results | not implemented |

---

## CLI entry point (12)

| ID | Case | Status |
|---|---|---|
| CLI-01 | `bdralph --help` → exit 0, stdout contains flag names | automated (T-01) |
| CLI-02 | `bdralph` (no args) → exit 1, stdout contains usage example | automated (T-02) |
| CLI-03 | `bdralph --max abc "task"` → exit 1, validation error | automated (T-03) |
| CLI-04 | `bdralph hlep` → exit 1, suggests help or prints usage | automated (T-04) |
| CLI-05 | `bdralph --mxa 10 "task"` → exit 1, suggests `--max` | automated (T-05) |
| CLI-06 | `bdralph "task"` (mocked) → exit 0 | automated (T-06) |
| CLI-07 | flags passed through to loop | automated (T-07) |
| CLI-08 | `BDRALPH_NO_UI=1 bdralph "task"` (mocked) → exit 0 | automated (T-08) |
| CLI-09 | SHIP summary printed | automated (T-09) |
| CLI-10 | BLOCKED summary printed | automated (T-10) |
| CLI-11 | Claude Code not installed → exit 1, install instruction | automated (T-11) |
| CLI-12 | Budget zero → exit 1, budget warning | automated (T-12) |

---

## Typo detection — smoke test

| ID | Case | Status |
|---|---|---|
| TYPO-01 | `bdralph hlep` → suggests `bdralph help` | automated (T-04) |
| TYPO-02 | `bdralp "task"` → suggests `bdralph` | not implemented (shell-level, outside bdralph scope) |
| TYPO-03 | `bdralph --mxa 10` → suggests `--max` | automated (T-05) |

---

## Ink panel (6)

| ID | Case | Status |
|---|---|---|
| PANEL-01 | Ink panel renders without TransformError — BDRALPH_INK_UI=1 + mock mode | automated (PANEL-01) |
| PANEL-02 | Panel displays correct fields — iteration/max, model, cost | automated (PANEL-02) |
| PANEL-03 | Process exits after SHIP without manual intervention | automated (PANEL-03) |
| PANEL-04 | BDRALPH_NO_UI=1 — Ink panel does not render | automated (PANEL-04) |
| PANEL-05 | Panel frames do not stack — single render frame visible at a time | not implemented |
| PANEL-06 | Panel cleans up terminal on SIGTERM — cursor restored, screen cleared | not implemented |
| PANEL-07 | `/dev/tty` exists but ENXIO — loop falls back to bash UI without crashing | automated (PANEL-05 — proxy via NO_UI) |

---

## Panel responsiveness (4)

| ID | Case | Status |
|---|---|---|
| PANEL-R-01 | Wide layout (≥120 cols) renders full header | automated (PANEL-R-01) |
| PANEL-R-02 | Narrow layout (<80 cols) renders without crash | automated (PANEL-R-02) |
| PANEL-R-03 | Minimalist mode (<15 rows) renders without crash | automated (PANEL-R-03) |
| PANEL-R-04 | Medium layout (80–119 cols) renders without crash | automated (PANEL-R-04) |

---

## Trace pipeline (1)

| ID | Case | Status |
|---|---|---|
| T-TRACE-10 | L1 sensitive path escalation — L1 detects sensitive path in diff, escalates to L4, l1_escalated field is true in L4 trace | not implemented (requires git state manipulation) |
