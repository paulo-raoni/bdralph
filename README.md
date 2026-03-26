# bdralph

*Governed agentic loops for Claude Code.*

bdralph wraps Claude Code as a worker inside a structured loop with a multi-layer review pipeline (L1–L4), operator controls, cost guard, and a terminal UI.

## Prerequisites

- Node.js 22+
- Claude Code (`claude --version`)

## Install

```bash
npm install
```

## Usage

```bash
bdralph "Add input validation to TaskService" --max 10 --worker sonnet
bdralph path/to/task.md --budget 1.00 --worker opus
```

Flags:
- `--max N` — max iterations (default: 10)
- `--budget USD` — cost ceiling (default: 0.50)
- `--worker sonnet|opus|auto` — worker model (default: sonnet)
- `--escalate-after N` — auto-escalation threshold (default: 3)
- `--reviewer-mode pipeline|single` — review strategy (default: pipeline)

Set `BDRALPH_NO_UI=1` for CI/headless environments.

## Documentation

- [docs/architecture.md](docs/architecture.md) — component map and design
- [docs/traces.md](docs/traces.md) — trace system and output files
- [docs/loop.md](docs/loop.md) — core loop scripts and configuration

## Status

[![CI](https://github.com/YOUR_USERNAME/bdralph/actions/workflows/ci.yml/badge.svg)](https://github.com/YOUR_USERNAME/bdralph/actions)
