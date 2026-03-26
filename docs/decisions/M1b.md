# M1b — Design Decisions

## M1b-01 — Entry point: bin field

**Decision:** `bdralph` is a binary registered via `package.json` bin field.
After `npm install`, `bdralph "task"` works directly in PATH without `./` or `npm run`.

**Alternatives considered:**
- Script at root (`./bdralph`) — requires `./`, does not install to PATH
- npm script (`npm run bdralph -- "task"`) — requires `--` separator, not operator-friendly

**Rationale:** Standard pattern for Node/shell CLIs. Satisfies the M1b gate:
operator runs `bdralph "task"` without knowing the internal structure.

---

## M1b-02 — Typo detection in bash

**Decision:** Typo detection for unknown flags and positional args is implemented
in bash only, inside `bin/bdralph`. No TypeScript or external dependencies.

**Rationale:** M1b is a bash entry point. Pulling in a TypeScript dependency for
typo detection would be scope creep. Levenshtein in bash is sufficient for the
small set of known flags. TypeScript enters naturally in M2 with the Ink panel.

---

## M1b-03 — Docs: structured placeholders with real content

**Decision:** `docs/architecture.md` and `docs/traces.md` are created with real
content for what exists today (M1a + M1b) and `<!-- TODO: MN -->` markers for
future milestones. No speculative content.

**Rationale:** Writing complete future content now would require rewriting at every
milestone. Placeholders preserve the structure without committing to content that
will change. Everything that exists today is documented accurately.

---

## M1b-04 — Session termination: summary output (option B)

**Decision:** When the loop ends (SHIP or BLOCKED), `bin/bdralph` prints a summary
to stdout: task, iterations, cost, result. Then the shell returns to the prompt.
No interactive prompt ("run another task?").

**Rationale:** CI-friendly. `BDRALPH_NO_UI=1` exists for headless environments.
Interactive prompts conflict with the project's philosophy of scriptability.
The REPL experience is deferred to M6b.

---

## M1b-05 — REPL terminal deferred to M6b

**Decision:** The persistent terminal experience (open `bdralph` with no args,
type tasks interactively, `/clear`, `exit`) is registered as M6b in BACKLOG.md.
Not implemented in M1b.

**Rationale:** The REPL requires Second Mind (M6) to be meaningful. Implementing
the shell without Second Mind would deliver an incomplete experience. M1b delivers
the one-shot CLI; M6b delivers the terminal.

---

## M1b-06 — BDRALPH_LOOP_MOCK=1 for testing

**Decision:** `bin/bdralph` supports a `BDRALPH_LOOP_MOCK=1` env var that bypasses
`ralph-loop.sh` and prints mock output. Used exclusively by `tests/cli/cli-smoke.test.ts`.

**Known limitation:** No production guard — any operator who exports this env var
will get mock output instead of a real loop. Severity: low (must be set deliberately).
A warning banner or NODE_ENV-style guard is registered in BACKLOG.md.
