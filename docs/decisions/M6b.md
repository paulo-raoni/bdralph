# M6b — Design Decisions

## M6b-01 — REPL mode detection

**Decision:** `bdralph` with no arguments opens the REPL. No additional flag required.
`bin/bdralph` detects the absence of a task argument and spawns the REPL instead of
printing an error.

**Rationale:** The REPL is the natural entry point when no task is specified. Adding a
flag (e.g. `--repl`) would be redundant — the absence of a task is already unambiguous.

---

## M6b-02 — Second Mind persistence across REPL sessions

**Decision:** Second Mind accumulates context for the entire duration of the REPL session.
`/clear` resets the loop context (iteration-log, traces, worker state) but does not reset
the Second Mind. `exit` (or a Second Mind command) shuts down the terminal and everything.

**Rationale:** The value of the Second Mind in the REPL is continuity — it remembers what
was attempted across multiple `/clear` cycles. Resetting it on `/clear` would lose that
continuity for no benefit.

---

## M6b-03 — Interactive flag configuration

**Decision:** `/set` without arguments displays the current flag state and available
options. `/set <flag> <value>` updates a flag for the next loop execution.
Tab completion is supported for flag names and their valid values.

Example:
```
> /set
  Current flags:
  max=10  worker=sonnet  budget=0.50  escalate-after=3

  /set max <N>
  /set worker <sonnet|opus|auto>
  /set budget <USD>
  /set escalate-after <N>

> /set worker [TAB]  →  sonnet | opus | auto
```

**Rationale:** The operator should not need to remember flag names or valid values.
Tab completion and a state display eliminate the need to consult `--help` during
an active REPL session.

---

## M6b-04 — Terminal behavior during loop execution

**Decision:** During loop execution, the executor terminal is read-only for worker
output. It accepts two categories of control commands only:

- `/stop --now | --after-this | --on-fail` — writes to `operator-signal.json`
- `/set <flag> <value>` — updates flags for the next iteration

No other input is accepted during execution. The Second Mind acknowledges receipt
of these commands in its panel section (e.g. "Stop scheduled after this iteration.").

**Rationale:** Keeping the executor terminal focused on worker output avoids ambiguity.
Control commands are the exception because they are time-sensitive and need to be
reachable without switching panels. Second Mind acknowledgement closes the feedback
loop without requiring the operator to navigate to the Second Mind section.

---

## M6b-05 — /btw discarded

**Decision:** `/btw` (asynchronous Second Mind channel during execution) is discarded.

**Rationale:** Would create two places to interact with the Second Mind (executor
terminal + Second Mind panel), introducing ambiguity and unnecessary complexity.
Second Mind operates exclusively in its panel section. One interface, one place.

**Condition to reopen:** If a concrete use case emerges where the operator needs
to pass context to the Second Mind without leaving the executor terminal, and the
complexity is justified by the benefit.

---

## M6b-06 — bdralph ask standalone

**Decision:** `bdralph ask "question"` outside the REPL is a legitimate use case.
Second Mind responds with limited context (no active session, no traces, no
iteration-log). Useful for quick queries without starting a loop.

**Rationale:** The standalone mode is less powerful but has valid uses (e.g. "what
does this project do?", "summarize the architecture"). It does not conflict with the
REPL interface.

---

## M6b-07 — REPL prompt routing

**Decision:** At the `>` prompt:
- Text without a prefix → new task submitted to the loop
- Interaction with Second Mind → done in the Second Mind panel section, not at `>`

`/stop` and `/set` are the only commands accepted at `>` during execution.
Between executions, `>` accepts tasks, `/set`, `/stop`, `/clear`, and `exit`.

**Rationale:** A single routing rule (no prefix = task) keeps the REPL simple and
predictable. The Second Mind having its own section eliminates the need for a
prefix-based dispatch between task and Second Mind at the prompt.
