# src/loop

The core loop scripts and Ink panel renderer for bdralph.

## Scripts and modules

### Loop orchestration (bash)

- `ralph-loop.sh` — main loop orchestrator. Worker + 4-layer review pipeline (L1–L4), state files, UI hooks, cost guard, shutdown handling.
- `llm-delegate.sh` — delegates a prompt to an external LLM provider and returns the response. Used by L2, L3, L4.
- `cost-guard.sh` — sourceable cost protection library. Tracks accumulated cost per iteration and halts the loop when the budget ceiling is reached.

### Ink panel renderer (TypeScript/React)

Located in `src/loop/ink/` — spawned as a background process by `ralph-loop.sh` when `BDRALPH_INK_UI=1`.

- `ralph-ink.ts` — entry point. Spawned by the loop, owns the process lifecycle (SIGTERM/SIGINT handlers, unmount, cursor restore).
- `ralph-ink-panel.tsx` — React/Ink component. Polls state files on a 150ms interval and worker output on a 200ms interval.
- `ralph-ink-helpers.ts` — pure helper functions (`readStateFile`, `readWorkerLines`, `formatCost`). Exported for testability.
- `package.json` — declares `"type": "module"` so that `tsx` compiles the Ink files as ESM (required by `yoga-layout`, an Ink dependency with top-level await).

---

## Usage

```bash
# Direct invocation (development / debugging)
bash src/loop/ralph-loop.sh "your task here" --max 10 --worker sonnet
bash src/loop/ralph-loop.sh /path/to/task.md --budget 1.00

# Normal usage — via bin/bdralph (recommended)
bash bin/bdralph "your task here" --max 10 --worker sonnet
```

---

## Sensitive paths

L1 checks all file changes against these paths. Any match triggers direct L4 escalation.

```bash
SENSITIVE_PATHS=(
  "CLAUDE.md"
  "docs/PROGRESS.md"
  "docs/BACKLOG.md"
  "docs/DECISIONS.md"
  "docs/decisions/"
  ".githooks/"
  "src/loop/"
)
```

Any change to this array must be reflected in this file.

---

## Environment variables

### Runtime flags

| Variable | Set by | Default | Description |
|---|---|---|---|
| `BDRALPH_NO_UI` | operator / CI | — | Set to `1` to disable the Ink panel. Worker stdout goes directly to terminal. |
| `BDRALPH_INK_UI` | `bin/bdralph` | — | Set to `1` to enable the Ink terminal renderer. Requires interactive TTY (`/dev/tty` readable and writable). Do not set manually — `bin/bdralph` handles this. |
| `BDRALPH_BUDGET` | `bin/bdralph` | `"0.50"` | Session budget in USD. Exported so the Ink panel can display budget remaining. |

### Provider chain

| Variable | Default | Description |
|---|---|---|
| `BDRALPH_L2_PROVIDER_CHAIN` | `openai-cheap gemini-flash` | Space-separated L2 provider chain |
| `BDRALPH_L3_PROVIDER_CHAIN` | `openai-standard gemini-flash openai-mini` | Space-separated L3 provider chain |
| `BDRALPH_PROVIDER_FAILOVER` | `notify` | `notify` or `pause` on provider failover |

### Testing only

| Variable | Default | Description |
|---|---|---|
| `BDRALPH_LOOP_MOCK` | — | Set to `1` to bypass `ralph-loop.sh` and print mock output. Never set in production. |
| `BDRALPH_MOCK_RESULT` | `SHIP` | `SHIP` or `BLOCKED` — controls mock output when `BDRALPH_LOOP_MOCK=1`. |
| `BDRALPH_MOCK_DUMP_ENV` | — | Set to `1` to print env var state in mock output (used by T-13 to verify `BDRALPH_INK_UI` is unset with `NO_UI=1`). |
| `BDRALPH_LLM_DELEGATE` | `src/loop/llm-delegate.sh` | Override path to `llm-delegate.sh`. Used in tests to inject a mock delegate. |

---

## State files

### Runtime state (`artifacts/bdralph/`)

Never committed. Persists for the duration of a session.

| File | Description |
|---|---|
| `task.md` | The task string passed to the loop |
| `iteration.txt` | Current iteration number |
| `review-result.txt` | Last review result (`SHIP` / `REVISE` / `BLOCKED`) |
| `review-feedback.txt` | Last review feedback text |
| `work-summary.txt` | Appended after each iteration: number, model, outcome, cost |
| `work-complete.txt` | Written once at loop exit: final status, total iterations, total cost, timestamp |
| `.bdralph-complete` | Sentinel file written on clean exit |
| `operator-signal.json` | Operator-to-loop communication. Checked at start of each iteration. Valid formats: `{"action":"stop-now"}`, `{"action":"stop-after-this"}`, `{"action":"stop-on-fail"}`, `{"action":"message","content":"..."}` |

### UI state files (`/tmp/ralph_ui_<SESSION_ID>_*.txt`)

Written by `ralph-loop.sh`, read by the Ink panel. Each file contains a single UTF-8 value. Cleaned up on loop exit.

`SESSION_ID` is generated at loop start as `date +%Y%m%dT%H%M%S-$$` (timestamp + PID). It is the base of `UI_STATE_PREFIX` and also appears in `iteration_report.jsonl` and `work-summary.txt`.

| Suffix | Content | Example |
|---|---|---|
| `_task.txt` | Task string | `"Add validation to TaskService"` |
| `_iteration.txt` | Current iteration number | `"3"` |
| `_max_iterations.txt` | Max iterations | `"10"` |
| `_worker_mode.txt` | Worker model label | `"sonnet"` |
| `_total_cost.txt` | Accumulated cost USD | `"0.08"` |
| `_total_tokens.txt` | Accumulated token count | `"12400"` |
| `_session_elapsed.txt` | Elapsed seconds since session start | `"142"` |
| `_worker_state.txt` | `waiting\|active\|done` | `"active"` |
| `_worker_output_preview.txt` | Last ~4 lines of worker output (bash UI) | multiline |
| `_worker_output.txt` | Full worker stdout (read by Ink panel) | multiline |
| `_banner_kind.txt` | Banner type if active | `"⚠️"` |
| `_banner_message.txt` | Banner message if active | `"L4 escalation triggered"` |
| `_{agent}_state.txt` | Agent state (`waiting\|active\|done`) for `worker`, `l1`, `l2`, `l3`, `l4` | `"active"` |
| `_{agent}_duration.txt` | Agent duration in seconds | `"12"` |
| `_{agent}_started.txt` | Agent start epoch | `"1711234567"` |
| `_{agent}_detail.txt` | Agent detail text | `"reviewing..."` |

### Logs (`logs/`)

Never committed.

| File | Description |
|---|---|
| `iteration_report.jsonl` | One JSON record per iteration: session, iteration, cost, outcome |

---

## Ink panel process lifecycle

The Ink panel is spawned by `ralph-loop.sh` as a background process when `BDRALPH_INK_UI=1` and `/dev/tty` is available:

```bash
setsid npx --prefix "$LOOP_DIR" tsx "$LOOP_DIR/ink/ralph-ink.ts" "$UI_STATE_PREFIX" \
  </dev/tty >/dev/tty 2>/dev/tty &
INK_RENDERER_PID=$!
```

Key implementation details:
- **`setsid`** — spawns the tsx process as leader of a new process group. Required so that `kill -- -$INK_RENDERER_PID` terminates the entire group (parent + tsx worker threads).
- **`kill -- -$INK_RENDERER_PID`** — kills the process group. Falls back to `kill $INK_RENDERER_PID` if the process is not a group leader.
- **`/dev/tty` streams** — stdin, stdout, and stderr of the Ink process are all wired to `/dev/tty`. The panel uses `openSync("/dev/tty", "w")` inside the component to get the correct stream for Ink's `render()` — without this, Ink uses `process.stdout` which may not match the tty fd, causing frames to stack instead of replacing each other.
- **ESM requirement** — `src/loop/ink/package.json` declares `"type": "module"`. The `tsx` compiler determines ESM vs CJS from the nearest `package.json`. Without this, `yoga-layout` (an Ink dependency with top-level await) fails with `ERR_REQUIRE_ASYNC_MODULE`. Do NOT add `"type": "module"` to the root `package.json` — the bash loop scripts use `node -e "require(...)"` extensively.

On loop exit (SHIP, BLOCKED, or signal), the loop sends SIGTERM to the process group. `ralph-ink.ts` handles SIGTERM by calling `instance.unmount()`, clearing the screen, restoring the cursor, and exiting.

---

## Review pipeline (L1–L4)

| Layer | Executor | Cost | Responsibility |
|---|---|---|---|
| L1 | bash (no LLM) | zero | Sensitivity check — scans git diff for changes to sensitive paths. Triggers L4 escalation on match. |
| L2 | cheap LLM | low | Protocol review — checks adherence to task constraints and coding standards. |
| L3 | standard LLM | medium | Quality review — deeper analysis of correctness, edge cases, test coverage. |
| L4 | opus-level LLM | high | Governance review — triggered by L1 escalation or repeated L3 revisions. Final authority on sensitive changes. |

<!-- TODO: M3 — document per-layer trace file schema (traces/lN-iteration-N.json) -->
<!-- TODO: M4 — document iteration-log.json schema -->
