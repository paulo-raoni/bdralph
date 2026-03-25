# src/loop

The core loop scripts for bdralph.

## Scripts

- `ralph-loop.sh` — main loop orchestrator. Worker + 4-layer review pipeline (L1–L4).
- `llm-delegate.sh` — delegates a prompt to an external LLM provider and returns the response.
- `cost-guard.sh` — sourceable cost protection library. Used by ralph-loop.sh.

## Usage

```bash
bash src/loop/ralph-loop.sh "your task here" --max 10 --worker sonnet
bash src/loop/ralph-loop.sh /path/to/task.md --budget 1.00
```

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

Any change to this array must be reflected in this README.

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `BDRALPH_NO_UI` | — | Set to `1` to disable the terminal UI (CI, headless) |
| `BDRALPH_L2_PROVIDER_CHAIN` | `openai-cheap gemini-flash` | Space-separated L2 provider chain |
| `BDRALPH_L3_PROVIDER_CHAIN` | `openai-standard gemini-flash openai-mini` | Space-separated L3 provider chain |
| `BDRALPH_PROVIDER_FAILOVER` | `notify` | `notify` or `pause` on provider failover |
| `BDRALPH_LLM_DELEGATE` | `src/loop/llm-delegate.sh` | Override path to llm-delegate.sh (testing) |

## State files

Runtime state lives in `artifacts/bdralph/` — never committed.
Logs live in `logs/` — never committed.
