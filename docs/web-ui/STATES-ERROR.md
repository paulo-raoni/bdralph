# Web UI — Error States

All error states must be implemented with graceful visuals. No silent failures, no blank sections.

---

## State 1 — Worker output: error lines

**Trigger**: worker output contains lines starting with error/exception markers.

**Visual**:
- Lines starting with `✗` or containing `Error:`, `FAIL`, `TypeError`, stack traces → prefix `✗` in `#f85149`, line text in `#f85149`
- Lines containing warnings (`⚠`, `warning`, `deprecated`) → prefix `⚠` in `#e3b341`, line text in `#e3b341`
- Normal lines remain unaffected

**No banner** — error lines are self-explanatory inline.

---

## State 2 — Worker crashed (non-zero exit code)

**Trigger**: Claude Code process exits with code ≠ 0.

**Visual**:
- Worker output panel header badge: `crashed` in red (`#f85149`)
- Red banner at top of worker output body:
  - Background: `#da363311`, border: `1px solid #f8514966`
  - Title: `Worker exited with code N`
  - Body: "Claude Code process terminated unexpectedly. The iteration was interrupted."
- Last lines of output shown below banner (for context)

---

## State 3 — Layer failed: provider error

**Trigger**: LLM provider call returns HTTP error (4xx, 5xx) or timeout.

**Visual**:
- Layer box: `error` state (red background, red border, red text)
- Pipeline panel header badge: `L{N} failed` in red
- Red banner below pipeline layers:
  - Title: `L{N} provider error — {provider} returned HTTP {code}`
  - Body: describes the error + fallback attempt if applicable
- Summary row: `L{N}: ERROR · {provider} · {reason}`

**Behavior**: loop attempts fallback provider if configured. If fallback succeeds, transitions to State 4. If no fallback, loop marks iteration as failed.

---

## State 4 — Provider fallback (warning, not error)

**Trigger**: primary provider fails, fallback provider succeeds.

**Visual**:
- Layer box: `warn` state (amber background, amber border, amber text)
- Pipeline panel header badge: `fallback` in amber
- Amber banner below pipeline layers:
  - Title: `L{N} fallback — {primary} unavailable, using {fallback}`
  - Body: "Review continued with fallback provider. Result may differ from primary."
- Summary row: `L{N}: {result} {fallback-provider} (fallback)`

**Note**: this is a degraded-but-functional state. Loop continues normally.

---

## State 5 — L1 escalation to L4

**Trigger**: L1 detects sensitive files in worker output (e.g. `CLAUDE.md`, `docs/DECISIONS.md`, `.githooks/`).

**Visual**:
- L1 box: `warn` state (amber)
- L2 and L3 boxes: `skip` state (dashed gray border)
- L4 box: `active` state (blue)
- Blue informational banner below layers:
  - Title: `L1 detected sensitive files — escalated directly to L4`
  - Body: lists modified sensitive files. "L2 and L3 skipped."
- Summary row: `L1: sensitive · L2/L3: skipped · L4: reviewing...`

---

## State 6 — BLOCKED (terminal state)

**Trigger**: loop reaches max iterations without a SHIP result.

**Visual**:
- Loop status badge changes to `● blocked` in red
- Stop buttons hidden (loop already stopped)
- Red banner in worker output area:
  - Title: `BLOCKED — max iterations reached without SHIP`
  - Body: "{N} of {N} iterations completed. Worker did not converge on a solution."
  - Suggestion line (muted): "Suggestion: decompose the task or clarify success criteria."
- Metrics shown as final values (no live updates)
- Pipeline shows last iteration state (frozen)

---

## State 7 — SHIPPED (terminal success state)

**Trigger**: L3 or L4 emits SHIP result.

**Visual**:
- Loop status badge changes to `● shipped` in green
- Stop buttons hidden (loop already stopped)
- Green banner in worker output area:
  - Title: `SHIPPED — task completed successfully`
  - Body: "Worker delivered approved work after {N} iteration(s)."
  - Note (muted): "All review layers passed. Changes ready to commit."
- Metrics shown as final values
- Pipeline shows last iteration state (frozen, all done/green)

---

## State 8 — Budget exhausted

**Trigger**: accumulated reviewer cost reaches `BDRALPH_BUDGET` limit.

**Visual**:
- Amber banner in alert bar area (replaces or appends to existing alerts):
  - Title: `Reviewer budget exhausted — $X.XX / $X.XX used`
  - Body: "Loop stopped to prevent overspend. Increase budget with `--budget` to continue."
- Loop stops after current iteration completes
- Status badge changes to `● stopped` in amber

---

## Color semantics summary

| Color | Meaning | States |
|---|---|---|
| Red | Error / blocked / crash | States 2, 3, 6 |
| Amber | Warning / degraded / budget | States 4, 5, 8 |
| Green | Success / shipped | State 7 |
| Blue | Info / escalation / in progress | State 5 (L4 active) |
| Dashed gray | Skipped / bypassed | State 5 (L2, L3) |
