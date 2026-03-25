# Edge Cases — bdralph E2E

All edge cases are `not implemented` until the corresponding milestone ships.

---

## Environment and setup (6)

| ID | Case | Status |
|---|---|---|
| ENV-01 | Claude Code not installed — clear error message with install instructions | not implemented |
| ENV-02 | No Claude Code authentication — clear error message | not implemented |
| ENV-03 | Incompatible Node version — fails fast with version requirement | not implemented |
| ENV-04 | `.bdralph.config.json` absent — uses defaults, does not crash | not implemented |
| ENV-05 | Invalid API key — provider error propagated clearly | not implemented |
| ENV-06 | Budget zeroed before start — fails fast with clear message | not implemented |

---

## Loop execution (7)

| ID | Case | Status |
|---|---|---|
| LOOP-01 | Completion signal absent after max iterations — BLOCKED status, improvement suggestion written | not implemented |
| LOOP-02 | Completion signal file empty — treated as not complete | not implemented |
| LOOP-03 | Diff gigantic (>500 files) — L3 escalates to L4 | not implemented |
| LOOP-04 | Internal infinite loop in worker — max iterations reached, BLOCKED | not implemented |
| LOOP-05 | Worker destroys test environment — afterAll cleanup still runs | not implemented |
| LOOP-06 | Max iterations reached without SHIP — improvement suggestion written | not implemented |
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
| SM-01 | `bdralph ask` without Second Mind active — clear error message | not implemented |
| SM-02 | Second Mind timeout — operator notified, loop continues | not implemented |
| SM-03 | Watchdog detects conflict with Second Mind busy — conflict queued, not dropped | not implemented |
| SM-04 | Gas Town without feature flag — clear error with `BDRALPH_GAS_TOWN=enabled` instruction | not implemented |
| SM-05 | Integration ralph fails — Second Mind does coherence check on partial results | not implemented |

---

## Typo detection — smoke test

| ID | Case | Status |
|---|---|---|
| TYPO-01 | `bdralph hlep` → suggests `bdralph help` | not implemented |
| TYPO-02 | `bdralp "task"` → suggests `bdralph` | not implemented |
| TYPO-03 | `bdralph --mxa 10` → suggests `--max` | not implemented |
