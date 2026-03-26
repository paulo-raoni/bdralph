# CLAUDE.md — bdralph

This file is the operational contract for Claude Code working inside this repository.
Read it completely before touching any file.

---

## 1. Project Identity

bdralph is a governed agentic loop runner for Claude Code.

Its goal is to provide a structured, observable, cost-controlled loop that wraps Claude Code as a worker, with a multi-layer review pipeline (L1–L4), operator controls, and a terminal UI.

Tagline: *"Governed agentic loops for Claude Code."*

---

## 2. Workflow

```
claude.ai            → strategic decisions, proposals, prompt generation, handoffs
Claude Code CLI      → implementation + opens PR (primary executor)
Claude Code Extension → reviews LOCAL changes in plan mode (not the PR)
```

**Complete PR flow:**
1. claude.ai generates prompt and saves as `.md` if long
2. Claude Code CLI implements + opens PR
3. claude.ai generates review prompt for the extension — always from local changes, not the PR
4. Extension reviews in plan mode
5. If issues → Claude Code CLI fixes on the same branch
6. Extension confirms → operator merges on GitHub
7. **Manual verification** by operator after merge

---

## 3. Sources of Truth

Read in this order before making any change:

- `docs/PROGRESS.md` — what milestones are done, in progress, and next
- `docs/DECISIONS.md` — index of key decisions, points to `docs/decisions/MN.md` for detail
- `docs/BACKLOG.md` — future ideas, not committed scope

---

## 4. Development Philosophy

- **Milestone-first** — one milestone at a time, no exceptions
- **Evidence-gated** — a milestone is not done until its gate criteria pass
- **Minimalism** — if it is not needed now, do not add it
- **Governance over improvisation** — every structural decision must be recorded in `docs/DECISIONS.md`

---

## 5. Working Protocol

### Before starting any task

1. Read `docs/PROGRESS.md` to confirm the current milestone scope.
2. Read `docs/DECISIONS.md` to understand key decisions already made.
3. Confirm the task does not touch sensitive paths (see Section 8).
4. If the task involves code changes, run the baseline health check:

```bash
npm run build
npm test
npm run lint
npm run typecheck
```

If any gate fails, STOP and report. Do not begin implementation until all gates pass.

### During implementation

- One objective per branch. Branch names must describe the work.
- Prefer small, scoped changes.
- Run CI gates after every meaningful change.
- Never commit runtime artifacts (`artifacts/`, `logs/`, `*.log`).

### After completing a task

Return this audit package:

```
1. Branch used
2. Files changed and why
3. git diff --stat
4. npm test output (pass/fail)
5. npm run lint output (pass/fail)
6. npm run typecheck output (pass/fail)
7. README reviewed and no changes required. (or: README updated.)
8. Summary of what was delivered
```

Missing the documentation declaration invalidates the delivery.

---

## 6. Milestone Discipline

**One milestone at a time. No exceptions.**

Do not implement future milestones. Do not expand scope. Do not merge concerns from different milestones into one branch.

If work reveals a gap belonging to a future milestone, record it as a finding in `docs/BACKLOG.md` and continue.

Backlog items are future ideas, not committed scope. Never implement them without explicit operator instruction.

---

## 7. CI Gates — Non-Negotiable

These commands must pass before any delivery:

```bash
npm run build
npm test
npm run lint
npm run typecheck
```

For PRs that affect E2E behavior:
```bash
BDRALPH_E2E_MODE=no-llm npx vitest run --config vitest.e2e.config.ts
```

A delivery where any gate fails is not a delivery.

**Exception — documentation-only PRs:**
PRs modifying exclusively `.md` files or `docs/PROGRESS.md` require only:
```bash
npm run typecheck
```

**Gate policy by PR type:**

| PR type | Gates required |
|---|---|
| Code changes (`.ts`, `.js`, `.py`) | `npm test` + `npm run typecheck` |
| Code changes (`.sh`) | `npm test` + `npm run lint` + `npm run typecheck` |
| Config changes (`.json`, `.gitignore`, `vitest.*.config.ts`) | `npm run typecheck` |
| Documentation only (`.md` files, `docs/`) | none |

When in doubt, run all gates.

---

## 8. Sensitive Paths — Never modify without explicit operator approval

```
CLAUDE.md
docs/PROGRESS.md
docs/BACKLOG.md
docs/DECISIONS.md
docs/decisions/
.githooks/
```

Any step that touches these files triggers automatic L1→L4 escalation in the review pipeline. If a task requires modifying these files, do it via Claude Code CLI directly after the loop — never inside a loop iteration.

---

## 9. .gitignore — Mandatory Before First Test

Before the first test runs, ensure `.gitignore` covers all runtime artifacts:
- `artifacts/`
- `logs/`
- `*.log`
- `node_modules/`
- `dist/`
- `.env` files
- Any file that appears as untracked during loop execution

If a new artifact type appears as untracked during development, add it to `.gitignore` immediately. Never commit runtime state.

---

## 10. Git Rules

- Never push directly to `main` — branch is protected
- Never rebase or force-push without seeing the git graph first
- Never generate review prompts from the PR — always from local changes on the branch
- Always create a branch, even for 1-line fixes

**Commit messages:** follow [Conventional Commits](https://www.conventionalcommits.org/). Examples: `feat: add cost guard`, `fix: threshold off-by-one`, `chore: update gitignore`, `docs: M0 decisions`. Adapt if a case doesn't fit cleanly.

**Branch naming convention:**

| Prefix | When to use |
|---|---|
| `feat/mN-description` | milestone implementation |
| `fix/description` | bug fix |
| `chore/description` | infra, lockfile, setup |
| `doc/description` | documentation only |
| `bootstrap/description` | initial structure |

Examples: `feat/m0-playground`, `fix/cost-guard-threshold`, `chore/gitignore-artifacts`, `doc/m0-decisions`

---

## 11. Language

All code, commits, PRs, docs, and comments are in English. No exceptions.

---

## 12. Forbidden Behaviors

Never do any of the following without explicit operator approval:

- Modify sensitive paths (Section 8)
- Implement future milestones or backlog items
- Expand milestone scope during implementation
- Commit directly to `main`
- Auto-merge pull requests
- Bypass CI gates or suppress their output
- Run `git add artifacts/` or `git add .` — always stage files explicitly by path
- Close a milestone without all gate criteria passing

---

## 13. Change Proposal Protocol

If you identify a necessary structural change, a governance gap, or a conflict:

**STOP.**

Do not implement. Do not work around it silently.

1. State clearly what the issue is
2. Identify which documents or modules are in conflict
3. Propose a specific resolution
4. Wait for explicit operator approval before proceeding

---

## 14. Executor Invocation

When running an implementation prompt, use the following commands to avoid manual approval at each step.

**Claude Code CLI** (inside devcontainer):

    claude --dangerously-skip-permissions < prompt.md

**Codex CLI** (inside devcontainer):

    codex exec --dangerously-bypass-approvals-and-sandbox < prompt.md

**Antigravity** (desktop IDE — no CLI headless mode):
Set Terminal Policy to **Always proceed** and Agent mode to **Agent-driven** in Antigravity Settings before passing the prompt. There is no command-line flag equivalent.

These modes bypass per-action approval prompts. Only use inside the devcontainer or a trusted isolated environment.

---

*This file may only be modified with explicit operator approval.*
