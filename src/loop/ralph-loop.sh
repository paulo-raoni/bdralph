#!/bin/bash
set -euo pipefail

# ralph-loop.sh — Adaptive optimization loop.
# Orchestrates Claude Code as worker and llm-delegate.sh as reviewer,
# with cost guard, hierarchical fallback, 4-layer review pipeline
# (L1 sensitivity → L2 protocol → L3 quality → L4 governance),
# and logging.

LOOP_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$LOOP_DIR/../.." && pwd)"
RALPH_DIR="$REPO_ROOT/artifacts/bdralph"
LOGS_DIR="$REPO_ROOT/logs"

# Overridable for testing
LLM_DELEGATE="${BDRALPH_LLM_DELEGATE:-$LOOP_DIR/llm-delegate.sh}"

# Source cost guard
# shellcheck source=cost-guard.sh
source "$LOOP_DIR/cost-guard.sh"

# --- Defaults ---
REVIEWER="openai-mini"
REVIEWER_MODE="pipeline"
MAX_ITERATIONS=10
BUDGET="0.50"
WORKER="sonnet"
ESCALATE_AFTER=3
TASK=""

# SENSITIVE_PATHS — source of truth for automatic L1→L4 escalation.
# Any change to this array MUST be reflected in src/loop/README.md.
SENSITIVE_PATHS=(
  "CLAUDE.md"
  "docs/PROGRESS.md"
  "docs/BACKLOG.md"
  "docs/DECISIONS.md"
  "docs/decisions/"
  ".githooks/"
  "src/loop/"
)

# --- Parse arguments ---
usage() {
  echo "Usage: $0 <task|task-file> [options]" >&2
  echo "Options:" >&2
  echo "  --reviewer <provider>     default: openai-mini" >&2
  echo "  --reviewer-mode <mode>    pipeline|single (default: pipeline)" >&2
  echo "  --max <n>                 default: 10" >&2
  echo "  --budget <usd>            default: 0.50" >&2
  echo "  --worker <mode>           sonnet|opus|auto (default: sonnet)" >&2
  echo "  --escalate-after <n>      auto escalation threshold (default: 3)" >&2
  exit 1
}

if [ $# -lt 1 ]; then
  usage
fi

# First positional arg is the task
TASK_ARG="$1"
shift

while [ $# -gt 0 ]; do
  case "$1" in
    --reviewer)
      REVIEWER="${2:-}"
      shift 2
      ;;
    --reviewer-mode)
      REVIEWER_MODE="${2:-pipeline}"
      if [[ "$REVIEWER_MODE" != "pipeline" && "$REVIEWER_MODE" != "single" ]]; then
        echo "Invalid --reviewer-mode value: $REVIEWER_MODE (must be pipeline or single)" >&2
        exit 1
      fi
      shift 2
      ;;
    --max)
      MAX_ITERATIONS="${2:-10}"
      shift 2
      ;;
    --budget)
      BUDGET="${2:-0.50}"
      shift 2
      ;;
    --worker)
      WORKER="${2:-sonnet}"
      if [[ "$WORKER" != "sonnet" && "$WORKER" != "opus" && "$WORKER" != "auto" ]]; then
        echo "Invalid --worker value: $WORKER (must be sonnet, opus, or auto)" >&2
        exit 1
      fi
      shift 2
      ;;
    --escalate-after)
      ESCALATE_AFTER="${2:-3}"
      shift 2
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      ;;
  esac
done

# Resolve task: if it's a file path, read it; otherwise use as string
if [ -f "$TASK_ARG" ]; then
  TASK=$(cat "$TASK_ARG")
else
  TASK="$TASK_ARG"
fi

# --- Setup directories ---
mkdir -p "$RALPH_DIR"
mkdir -p "$LOGS_DIR"

# --- Session ID ---
SESSION_ID="$(date +%Y%m%dT%H%M%S)-$$"
SESSION_TOTAL_COST=0
SESSION_TOTAL_TOKENS=0
LAST_LLM_INPUT_TOKENS=0
LAST_LLM_OUTPUT_TOKENS=0
LAST_LLM_TOTAL_TOKENS=0

# --- Initialize cost guard ---
export LLM_MAX_EXECUTION_COST_USD="$BUDGET"
cost_guard_init

# --- Save task and clean state ---
echo "$TASK" > "$RALPH_DIR/task.md"
rm -f "$RALPH_DIR/review-result.txt"
rm -f "$RALPH_DIR/review-feedback.txt"
rm -f "$RALPH_DIR/work-complete.txt"
rm -f "$RALPH_DIR/work-summary.txt"
rm -f "$RALPH_DIR/.bdralph-complete"

# --- UI auto-detect ---
UI_ENABLED=true
if [ "${BDRALPH_NO_UI:-}" = "1" ]; then UI_ENABLED=false
elif [ ! -t 1 ]; then UI_ENABLED=false
elif [ "${TERM:-}" = "dumb" ] || [ -z "${TERM:-}" ]; then UI_ENABLED=false
fi

UI_STATE_PREFIX="/tmp/ralph_ui_${SESSION_ID}"
UI_WORKER_OUTPUT_FILE="${UI_STATE_PREFIX}_worker_output.txt"
UI_RENDER_LOCK_DIR="${UI_STATE_PREFIX}_render.lock"
UI_SESSION_START_EPOCH=$(date +%s)
UI_SPINNER_PID=""
UI_TIMER_PID=""
UI_CURSOR_HIDDEN=false
UI_OWNER_PID="${BASHPID:-$$}"
UI_STATE_ENABLED="$UI_ENABLED"

# --- ink renderer ---
# RALPH_INK_UI=1 is set by RalphCommandHandler when invoked via `agentic ralph`.
# Suppresses bash Phase 1 UI and starts the ink renderer instead.
RALPH_INK_ACTIVE=false
INK_RENDERER_PID=""
if [ "${BDRALPH_INK_UI:-}" = "1" ] && [ "${BDRALPH_NO_UI:-}" != "1" ] && [ "${TERM:-}" != "dumb" ] && [ -n "${TERM:-}" ] && [ -r /dev/tty ] && [ -w /dev/tty ]; then
  RALPH_INK_ACTIVE=true
  UI_STATE_ENABLED=true
  UI_ENABLED=false
  npx --prefix "$LOOP_DIR" tsx "$LOOP_DIR/ralph-ink.ts" "$UI_STATE_PREFIX" </dev/tty >/dev/tty 2>/dev/tty &
  INK_RENDERER_PID=$!
fi

status_echo() {
  if [ "$UI_ENABLED" != "true" ] && [ "$RALPH_INK_ACTIVE" != "true" ]; then
    echo "$@"
  fi
}

ensure_cost_guard_session() {
  if [ ! -f "${COST_GUARD_SESSION_FILE:-}" ]; then
    cost_guard_init >/dev/null 2>&1
  fi
}

read_llm_usage_field() {
  local field="$1"
  local default_value="${2:-0}"

  node -e "
    try {
      const data = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8'));
      const value = data['${field}'];
      if (value === undefined || value === null || value === '') process.exit(1);
      process.stdout.write(String(value));
    } catch (error) {
      process.exit(1);
    }
  " 2>/dev/null || printf '%s' "$default_value"
}

ui_file() {
  printf '%s_%s.txt' "$UI_STATE_PREFIX" "$1"
}

ui_write_value() {
  if [ "${UI_STATE_ENABLED:-false}" != "true" ]; then
    return 0
  fi

  local key="$1"
  shift || true
  printf '%s' "$*" > "$(ui_file "$key")"
}

ui_read_value() {
  local key="$1"
  local default_value="${2:-}"
  local file
  file="$(ui_file "$key")"

  if [ -f "$file" ]; then
    cat "$file"
  else
    printf '%s' "$default_value"
  fi
}

ui_clamp_width() {
  local cols
  cols=$(tput cols 2>/dev/null || echo 80)
  if [ "$cols" -lt 60 ]; then
    cols=60
  elif [ "$cols" -gt 100 ]; then
    cols=100
  fi
  printf '%s' "$cols"
}

ui_repeat_char() {
  local char="$1"
  local count="$2"
  if [ "$count" -le 0 ]; then
    return 0
  fi
  printf '%*s' "$count" '' | tr ' ' "$char"
}

ui_get_agent_render_values() {
  local agent="$1"
  local state detail duration start_epoch spinner_index now elapsed label icon status duration_text subline
  state="$(ui_read_value "${agent}_state" "waiting")"
  detail="$(ui_read_value "${agent}_detail" "")"
  duration="$(ui_read_value "${agent}_duration" "0")"
  start_epoch="$(ui_read_value "${agent}_started" "0")"
  spinner_index="$(ui_read_value spinner_index "0")"
  label="$(ui_agent_label "$agent")"
  icon="$(ui_agent_icon "$agent")"
  now=$(date +%s)

  status="○ waiting"
  duration_text=""
  subline=""

  case "$state" in
    active)
      status="$(ui_read_value spinner_frame "⠋") $(ui_agent_verb "$agent" "$spinner_index")..."
      if [ "$start_epoch" -gt 0 ] 2>/dev/null; then
        elapsed=$((now - start_epoch))
      else
        elapsed=0
      fi
      duration_text="$(ui_format_duration "$elapsed")"
      ;;
    done)
      if [ -n "$detail" ]; then
        status="✓ $detail"
      else
        status="✓ done"
      fi
      duration_text="$(ui_format_duration "$duration")"
      ;;
    skip)
      status="— skipped"
      ;;
    waiting|*)
      status="○ waiting"
      ;;
  esac

  if [ "$agent" = "worker" ]; then
    case "$state" in
      active)
        subline="     └─ thinking ${duration_text}"
        ;;
      done)
        subline="     └─ thought ${duration_text}"
        ;;
    esac
  fi

  printf '%s\n%s\n%s\n%s\n%s\n' "$icon" "$label" "$status" "$duration_text" "$subline"
}

ui_capture_worker_output_preview() {
  if [ "${UI_STATE_ENABLED:-false}" != "true" ]; then
    return 0
  fi

  local preview=""
  if [ -f "$UI_WORKER_OUTPUT_FILE" ]; then
    preview=$(tail -n 6 "$UI_WORKER_OUTPUT_FILE" 2>/dev/null | tr '\t' ' ' | LC_ALL=C tr -d '\000-\010\013\014\016-\037' | sed '/^[[:space:]]*$/d' | tail -n 4)
  fi

  if [ -z "$preview" ]; then
    preview="No worker output captured."
  fi

  ui_write_value worker_output_preview "$preview"
  ui_render
}

ui_format_duration() {
  local total="${1:-0}"
  if ! [[ "$total" =~ ^[0-9]+$ ]]; then
    total=0
  fi

  if [ "$total" -ge 3600 ]; then
    printf '%02d:%02d:%02d' $((total / 3600)) $(((total % 3600) / 60)) $((total % 60))
  elif [ "$total" -ge 60 ]; then
    printf '%dm %02ds' $((total / 60)) $((total % 60))
  else
    printf '00:%02d' "$total"
  fi
}

ui_agent_icon() {
  case "$1" in
    worker) printf '🔨' ;;
    l1) printf '🔒' ;;
    l2) printf '📋' ;;
    l3) printf '🔍' ;;
    l4) printf '🏛' ;;
  esac
}

ui_agent_label() {
  case "$1" in
    worker) printf 'Worker (%s)' "$(ui_read_value worker_mode "$WORKER")" ;;
    l1) printf 'L1 Sensitivity' ;;
    l2) printf 'L2 Protocol' ;;
    l3) printf 'L3 Quality' ;;
    l4) printf 'L4 Governance' ;;
  esac
}

ui_agent_verb() {
  local agent="$1"
  local index="${2:-0}"
  case "$agent" in
    worker)
      case $((index % 6)) in
        0) printf 'Implementing' ;;
        1) printf 'Crafting' ;;
        2) printf 'Forging' ;;
        3) printf 'Assembling' ;;
        4) printf 'Building' ;;
        5) printf 'Constructing' ;;
      esac
      ;;
    l1)
      case $((index % 5)) in
        0) printf 'Scanning' ;;
        1) printf 'Inspecting' ;;
        2) printf 'Probing' ;;
        3) printf 'Surveying' ;;
        4) printf 'Mapping' ;;
      esac
      ;;
    l2)
      case $((index % 5)) in
        0) printf 'Verifying' ;;
        1) printf 'Auditing' ;;
        2) printf 'Cross-checking' ;;
        3) printf 'Validating' ;;
        4) printf 'Confirming' ;;
      esac
      ;;
    l3)
      case $((index % 5)) in
        0) printf 'Analyzing' ;;
        1) printf 'Dissecting' ;;
        2) printf 'Scrutinizing' ;;
        3) printf 'Evaluating' ;;
        4) printf 'Reviewing' ;;
      esac
      ;;
    l4)
      case $((index % 5)) in
        0) printf 'Deliberating' ;;
        1) printf 'Adjudicating' ;;
        2) printf 'Weighing' ;;
        3) printf 'Examining' ;;
        4) printf 'Ruling' ;;
      esac
      ;;
  esac
}

ui_render() {
  if [ "$UI_ENABLED" != "true" ]; then
    return 0
  fi

  mkdir "$UI_RENDER_LOCK_DIR" 2>/dev/null || return 0

  local width inner_width header_line task_line elapsed_text total_cost total_tokens iteration max_iterations banner_kind banner_message preview_text
  local -a worker_render l1_render l2_render l3_render l4_render
  width="$(ui_clamp_width)"
  inner_width=$((width - 2))
  elapsed_text="$(ui_format_duration "$(ui_read_value session_elapsed "0")")"
  total_cost="$(ui_read_value total_cost "0")"
  total_tokens="$(ui_read_value total_tokens "0")"
  iteration="$(ui_read_value iteration "1")"
  max_iterations="$(ui_read_value max_iterations "$MAX_ITERATIONS")"
  banner_kind="$(ui_read_value banner_kind "")"
  banner_message="$(ui_read_value banner_message "")"
  preview_text="$(ui_read_value worker_output_preview "")"

  header_line="  Ralph Loop  •  Iteration ${iteration} / ${max_iterations}  •  ${elapsed_text}"
  if [ "$total_tokens" -gt 0 ] 2>/dev/null; then
    header_line="${header_line}  •  ${total_tokens} tok"
  fi
  header_line="${header_line}  •  \$${total_cost}"
  task_line="  Task: $(ui_read_value task "$TASK")"

  mapfile -t worker_render < <(ui_get_agent_render_values worker)
  mapfile -t l1_render < <(ui_get_agent_render_values l1)
  mapfile -t l2_render < <(ui_get_agent_render_values l2)
  mapfile -t l3_render < <(ui_get_agent_render_values l3)
  mapfile -t l4_render < <(ui_get_agent_render_values l4)

  UI_WIDTH="$width" \
  UI_INNER_WIDTH="$inner_width" \
  UI_HEADER_LINE="$header_line" \
  UI_TASK_LINE="$task_line" \
  UI_BANNER_KIND="$banner_kind" \
  UI_BANNER_MESSAGE="$banner_message" \
  UI_PREVIEW_TEXT="$preview_text" \
  UI_WORKER_ICON="${worker_render[0]}" \
  UI_WORKER_LABEL="${worker_render[1]}" \
  UI_WORKER_STATUS="${worker_render[2]}" \
  UI_WORKER_DURATION="${worker_render[3]}" \
  UI_WORKER_SUBLINE="${worker_render[4]}" \
  UI_L1_ICON="${l1_render[0]}" \
  UI_L1_LABEL="${l1_render[1]}" \
  UI_L1_STATUS="${l1_render[2]}" \
  UI_L1_DURATION="${l1_render[3]}" \
  UI_L2_ICON="${l2_render[0]}" \
  UI_L2_LABEL="${l2_render[1]}" \
  UI_L2_STATUS="${l2_render[2]}" \
  UI_L2_DURATION="${l2_render[3]}" \
  UI_L3_ICON="${l3_render[0]}" \
  UI_L3_LABEL="${l3_render[1]}" \
  UI_L3_STATUS="${l3_render[2]}" \
  UI_L3_DURATION="${l3_render[3]}" \
  UI_L4_ICON="${l4_render[0]}" \
  UI_L4_LABEL="${l4_render[1]}" \
  UI_L4_STATUS="${l4_render[2]}" \
  UI_L4_DURATION="${l4_render[3]}" \
  node <<'NODE' > "${UI_STATE_PREFIX}_frame.txt"
const width = Number(process.env.UI_WIDTH || "80");
const innerWidth = Number(process.env.UI_INNER_WIDTH || String(width - 2));
const leftWidth = Math.floor(innerWidth * 0.42);
const midWidth = Math.floor(innerWidth * 0.33);
const rightWidth = innerWidth - leftWidth - midWidth;

function charWidth(ch) {
  if (/[\p{Extended_Pictographic}]/u.test(ch)) return 2;
  const cp = ch.codePointAt(0);
  if (cp >= 0x2800 && cp <= 0x28ff) return 2;
  if (
    (cp >= 0x1100 && cp <= 0x115f) ||
    cp === 0x2329 ||
    cp === 0x232a ||
    (cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe10 && cp <= 0xfe19) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6)
  ) return 2;
  return 1;
}

function visualWidth(str) {
  return Array.from(str).reduce((sum, ch) => sum + charWidth(ch), 0);
}

function fit(text, targetWidth, align = "left") {
  const trimMarker = "...";
  let out = text || "";
  if (targetWidth <= 0) return "";
  if (visualWidth(out) > targetWidth) {
    let available = targetWidth;
    if (targetWidth > visualWidth(trimMarker)) available -= visualWidth(trimMarker);
    let next = "";
    let used = 0;
    for (const ch of Array.from(out)) {
      const cw = charWidth(ch);
      if (used + cw > available) break;
      next += ch;
      used += cw;
    }
    out = targetWidth <= visualWidth(trimMarker) ? next : next + trimMarker;
  }
  const pad = Math.max(0, targetWidth - visualWidth(out));
  if (align === "right") return " ".repeat(pad) + out;
  if (align === "center") {
    const left = Math.floor(pad / 2);
    return " ".repeat(left) + out + " ".repeat(pad - left);
  }
  return out + " ".repeat(pad);
}

function boxLine(content = "") {
  return `║${fit(content, innerWidth)}║`;
}

function horizontal(left, fill, right) {
  return `${left}${fill.repeat(innerWidth)}${right}`;
}

function agentLine(icon, label, status, duration) {
  return `║${fit(`  ${icon} ${label}`, leftWidth)}${fit(status, midWidth)}${fit(duration, rightWidth, "right")}║`;
}

const lines = [];
lines.push(horizontal("╔", "═", "╗"));
lines.push(boxLine(process.env.UI_HEADER_LINE || ""));
lines.push(horizontal("╠", "═", "╣"));
lines.push(boxLine(""));
lines.push(boxLine(process.env.UI_TASK_LINE || ""));
lines.push(boxLine(""));
lines.push(horizontal("╠", "═", "╣"));
lines.push(boxLine(""));

if (process.env.UI_BANNER_KIND) {
  let banner = `  ${process.env.UI_BANNER_KIND}`;
  if (process.env.UI_BANNER_MESSAGE) banner += `  •  ${process.env.UI_BANNER_MESSAGE}`;
  lines.push(boxLine(banner));
  lines.push(boxLine(""));
} else {
  lines.push(agentLine(process.env.UI_WORKER_ICON, process.env.UI_WORKER_LABEL, process.env.UI_WORKER_STATUS, process.env.UI_WORKER_DURATION));
  lines.push(boxLine(process.env.UI_WORKER_SUBLINE || ""));
  lines.push(boxLine(""));
  lines.push(agentLine(process.env.UI_L1_ICON, process.env.UI_L1_LABEL, process.env.UI_L1_STATUS, process.env.UI_L1_DURATION));
  lines.push(boxLine(""));
  lines.push(agentLine(process.env.UI_L2_ICON, process.env.UI_L2_LABEL, process.env.UI_L2_STATUS, process.env.UI_L2_DURATION));
  lines.push(boxLine(""));
  lines.push(agentLine(process.env.UI_L3_ICON, process.env.UI_L3_LABEL, process.env.UI_L3_STATUS, process.env.UI_L3_DURATION));
  lines.push(boxLine(""));
  lines.push(agentLine(process.env.UI_L4_ICON, process.env.UI_L4_LABEL, process.env.UI_L4_STATUS, process.env.UI_L4_DURATION));
  lines.push(boxLine(""));
}

lines.push(horizontal("╚", "═", "╝"));

const previewText = (process.env.UI_PREVIEW_TEXT || "").trim();
if (previewText) {
  lines.push("");
  lines.push(horizontal("╔", "═", "╗"));
  lines.push(boxLine("  Worker Output Preview"));
  lines.push(horizontal("╠", "═", "╣"));
  for (const line of previewText.split("\n")) {
    lines.push(boxLine(`  ${line}`));
  }
  lines.push(horizontal("╚", "═", "╝"));
}

process.stdout.write(lines.join("\n"));
NODE

  if [ "$UI_CURSOR_HIDDEN" != "true" ]; then
    printf '\033[?25l'
    UI_CURSOR_HIDDEN=true
  fi

  printf '\033[H\033[2J'
  cat "${UI_STATE_PREFIX}_frame.txt"

  rmdir "$UI_RENDER_LOCK_DIR" 2>/dev/null || true
}

ui_set_agent_state() {
  if [ "${UI_STATE_ENABLED:-false}" != "true" ]; then
    return 0
  fi

  local agent="$1"
  local state="$2"
  local detail="${3:-}"
  local duration="${4:-0}"
  local started_epoch

  ui_write_value "${agent}_state" "$state"
  ui_write_value "${agent}_detail" "$detail"

  if [ "$state" = "active" ]; then
    ui_write_value "${agent}_started" "$(date +%s)"
  elif [ "$state" = "done" ] && [ "$duration" = "0" ]; then
    started_epoch="$(ui_read_value "${agent}_started" "0")"
    if [[ "$started_epoch" =~ ^[0-9]+$ ]] && [ "$started_epoch" -gt 0 ]; then
      duration="$(( $(date +%s) - started_epoch ))"
    fi
  else
    ui_write_value "${agent}_started" "0"
  fi

  ui_write_value "${agent}_duration" "$duration"

  ui_render
}

ui_clear_banner() {
  if [ "${UI_STATE_ENABLED:-false}" != "true" ]; then
    return 0
  fi
  ui_write_value banner_kind ""
  ui_write_value banner_message ""
}

ui_show_banner() {
  if [ "${UI_STATE_ENABLED:-false}" != "true" ]; then
    return 0
  fi
  ui_write_value banner_kind "$1"
  ui_write_value banner_message "${2:-}"
  ui_render
}

ui_increment_usage() {
  if [ "${UI_STATE_ENABLED:-false}" != "true" ]; then
    return 0
  fi

  local input_tokens="${1:-0}"
  local output_tokens="${2:-0}"
  local cost_usd="${3:-0}"
  local existing_tokens existing_cost
  existing_tokens="$(ui_read_value total_tokens "0")"
  existing_cost="$(ui_read_value total_cost "0")"
  existing_tokens=$((existing_tokens + input_tokens + output_tokens))
  ui_write_value total_tokens "$existing_tokens"
  ui_write_value total_cost "$(node -e "console.log(Math.round((Number(process.argv[1]) + Number(process.argv[2])) * 1e9) / 1e9)" "$existing_cost" "$cost_usd")"
  ui_render
}

ui_prepare_iteration() {
  if [ "${UI_STATE_ENABLED:-false}" != "true" ]; then
    return 0
  fi

  ui_write_value iteration "$1"
  ui_write_value max_iterations "$2"
  ui_write_value worker_mode "$3"
  ui_write_value worker_output_preview ""
  ui_write_value worker_tokens ""
  ui_write_value l1_tokens "0"
  ui_write_value l2_tokens "0"
  ui_write_value l3_tokens "0"
  ui_write_value l4_tokens ""
  ui_clear_banner
  ui_set_agent_state worker waiting "" 0
  ui_set_agent_state l1 waiting "" 0
  ui_set_agent_state l2 waiting "" 0
  ui_set_agent_state l3 waiting "" 0
  ui_set_agent_state l4 waiting "" 0
}

ui_spinner_loop() {
  local frames=("⠋" "⠙" "⠹" "⠸" "⠼" "⠴" "⠦" "⠧" "⠇" "⠏")
  local index=0
  while true; do
    ui_write_value spinner_index "$index"
    ui_write_value spinner_frame "${frames[$index]}"
    ui_render
    index=$(((index + 1) % ${#frames[@]}))
    sleep 0.5
  done
}

ui_timer_loop() {
  while true; do
    ui_write_value session_elapsed "$(( $(date +%s) - UI_SESSION_START_EPOCH ))"
    ui_render
    sleep 1
  done
}

ui_init() {
  if [ "${UI_STATE_ENABLED:-false}" != "true" ]; then
    return 0
  fi

  rm -f "${UI_STATE_PREFIX}"_*.txt "$UI_WORKER_OUTPUT_FILE"
  ui_write_value task "$(echo "$TASK" | tr '\n' ' ' | sed 's/[[:space:]]\+/ /g; s/^ //; s/ $//')"
  ui_write_value total_cost "0"
  ui_write_value total_tokens "0"
  ui_write_value session_elapsed "0"
  ui_write_value spinner_index "0"
  ui_write_value spinner_frame "⠋"
  ui_write_value worker_mode "$(get_worker_ui_mode)"
  ui_prepare_iteration 1 "$MAX_ITERATIONS" "$(get_worker_ui_mode)"
  ui_render
  ui_spinner_loop &
  UI_SPINNER_PID=$!
  ui_timer_loop &
  UI_TIMER_PID=$!
}

ui_cleanup() {
  if [ "${BASHPID:-$$}" != "${UI_OWNER_PID:-}" ]; then
    return 0
  fi

  if [ "${UI_STATE_ENABLED:-false}" = "true" ]; then
    if [ -n "${UI_SPINNER_PID:-}" ]; then
      kill "$UI_SPINNER_PID" 2>/dev/null || true
      wait "$UI_SPINNER_PID" 2>/dev/null || true
    fi
    if [ -n "${UI_TIMER_PID:-}" ]; then
      kill "$UI_TIMER_PID" 2>/dev/null || true
      wait "$UI_TIMER_PID" 2>/dev/null || true
    fi
    rm -f "${UI_STATE_PREFIX}"_*.txt "$UI_WORKER_OUTPUT_FILE"
  fi

  if [ "$RALPH_INK_ACTIVE" = "true" ] && [ -n "${INK_RENDERER_PID:-}" ]; then
    kill "$INK_RENDERER_PID" 2>/dev/null || true
    wait "$INK_RENDERER_PID" 2>/dev/null || true
  fi

  if [ "$UI_ENABLED" = "true" ]; then
    printf '\033[?25h\n'
    UI_CURSOR_HIDDEN=false
  fi
}

if [ "${UI_STATE_ENABLED:-false}" = "true" ] || [ "$RALPH_INK_ACTIVE" = "true" ]; then
  trap ui_cleanup EXIT
fi

# --- Worker model state ---
CONSECUTIVE_REVISES=0
WORKER_ESCALATED=false

get_worker_model_flag() {
  case "$WORKER" in
    opus) echo "--model claude-opus-4-6" ;;
    auto)
      if [ "$WORKER_ESCALATED" = "true" ]; then
        echo "--model claude-opus-4-6"
      fi
      ;;
    sonnet|*) echo "" ;;
  esac
}

get_worker_display_name() {
  if [ "$WORKER" = "opus" ] || { [ "$WORKER" = "auto" ] && [ "$WORKER_ESCALATED" = "true" ]; }; then
    echo "claude-opus-4-6"
  else
    echo "claude-sonnet-4-6"
  fi
}

get_worker_ui_mode() {
  if [ "$WORKER" = "opus" ] || { [ "$WORKER" = "auto" ] && [ "$WORKER_ESCALATED" = "true" ]; }; then
    echo "opus"
  else
    echo "sonnet"
  fi
}

# --- Print header ---
ui_init

status_echo "═══════════════════════════════════════════════════════════════"
status_echo "  bdralph — Governed agentic loops for Claude Code"
status_echo "═══════════════════════════════════════════════════════════════"
status_echo "  Task:     $TASK"
status_echo "  Worker:   $(get_worker_display_name) (mode: $WORKER)"
status_echo "  Reviewer: $REVIEWER"
status_echo "  Review:   $REVIEWER_MODE mode"
status_echo "  Max:      $MAX_ITERATIONS iterations"
status_echo "  Budget:   \$$BUDGET USD (reviewer cost)"
if [ "$WORKER" = "auto" ]; then
  status_echo "  Escalate: after $ESCALATE_AFTER consecutive REVISE(s)"
fi
status_echo ""

# --- Reviewer fallback hierarchy ---
REVIEWER_FALLBACK=("openai-mini" "gemini-flash" "claude-haiku" "claude-sonnet")

# Per-layer provider chains for pipeline mode.
# Override via env var: BDRALPH_L2_PROVIDER_CHAIN and BDRALPH_L3_PROVIDER_CHAIN
# (space-separated, e.g. BDRALPH_L2_PROVIDER_CHAIN="openai-cheap gemini-flash")
IFS=' ' read -r -a L2_PROVIDER_CHAIN <<< "${BDRALPH_L2_PROVIDER_CHAIN:-openai-cheap gemini-flash}"
IFS=' ' read -r -a L3_PROVIDER_CHAIN <<< "${BDRALPH_L3_PROVIDER_CHAIN:-openai-standard gemini-flash openai-mini}"

# Provider failover notification mode.
# notify (default): log the switch and continue automatically
# pause: log the switch and wait for operator confirmation
RALPH_PROVIDER_FAILOVER="${BDRALPH_PROVIDER_FAILOVER:-notify}"

EXTREME_FALLBACK_ACTIVE=false

# --- get_active_reviewer ---
# Walks the fallback hierarchy starting from the configured reviewer.
# Sets ACTIVE_REVIEWER or triggers EXTREME_FALLBACK.
get_active_reviewer() {
  ensure_cost_guard_session

  # Find start index in fallback array
  local start_idx=0
  for _reviewer_idx in "${!REVIEWER_FALLBACK[@]}"; do
    if [ "${REVIEWER_FALLBACK[$_reviewer_idx]}" = "$REVIEWER" ]; then
      start_idx=$_reviewer_idx
      break
    fi
  done

  for (( _reviewer_idx=start_idx; _reviewer_idx<${#REVIEWER_FALLBACK[@]}; _reviewer_idx++ )); do
    local candidate="${REVIEWER_FALLBACK[$_reviewer_idx]}"
    # claude-haiku and claude-sonnet are not external — no cost guard check
    if [ "$candidate" = "claude-haiku" ] || [ "$candidate" = "claude-sonnet" ]; then
      ACTIVE_REVIEWER="$candidate"
      return 0
    fi
    # External provider — check if blocked
    if ! cost_guard_is_blocked "$candidate"; then
      ACTIVE_REVIEWER="$candidate"
      return 0
    fi
  done

  # All exhausted — extreme fallback
  EXTREME_FALLBACK_ACTIVE=true
  ACTIVE_REVIEWER="EXTREME_FALLBACK"

  if [ "${RALPH_NON_INTERACTIVE:-}" = "1" ]; then
    return 0
  fi

  if [ "${UI_STATE_ENABLED:-false}" = "true" ]; then
    ui_show_banner "⚠ EXTREME FALLBACK" "press Enter to continue"
  fi
  status_echo ""
  status_echo "⚠️  MODO FALLBACK EXTREMO ATIVADO"
  status_echo "════════════════════════════════════════"
  status_echo "Todos os reviewers falharam ou estão bloqueados."
  status_echo "O loop vai continuar SEM revisão automática."
  status_echo "Qualidade não está garantida."
  status_echo "Você é o único revisor neste modo."
  status_echo "Pressione ENTER para continuar ou Ctrl+C para abortar."
  status_echo "════════════════════════════════════════"
  read -r
  ui_clear_banner
}

# --- call_llm_delegate ---
# Calls llm-delegate and records cost. Sets REVIEW_OUTPUT and accumulates REVIEWER_COST.
# Returns 0 on success, 1 on failure.
call_llm_delegate() {
  local provider="$1"
  local prompt="$2"

  ensure_cost_guard_session
  LAST_LLM_INPUT_TOKENS=0
  LAST_LLM_OUTPUT_TOKENS=0
  LAST_LLM_TOTAL_TOKENS=0

  if ! cost_guard_check "$provider" 500 200; then
    return 1
  fi

  local output
  output=$(bash "$LLM_DELEGATE" "$provider" "$prompt") || return 1
  REVIEW_OUTPUT="$output"

  if [ -f /tmp/llm_delegate_usage.json ]; then
    local usage_json li lo lc
    usage_json=$(cat /tmp/llm_delegate_usage.json 2>/dev/null || true)
    if [ -n "$usage_json" ]; then
      li=$(printf '%s' "$usage_json" | read_llm_usage_field input_tokens 0)
      lo=$(printf '%s' "$usage_json" | read_llm_usage_field output_tokens 0)
      lc=$(printf '%s' "$usage_json" | read_llm_usage_field cost_usd 0)
      LAST_LLM_INPUT_TOKENS="$li"
      LAST_LLM_OUTPUT_TOKENS="$lo"
      LAST_LLM_TOTAL_TOKENS=$((li + lo))
      ensure_cost_guard_session
      cost_guard_record "$provider" "$li" "$lo"
      REVIEWER_COST=$(node -e "console.log(Math.round(($REVIEWER_COST + $lc) * 1e9) / 1e9)")
      SESSION_TOTAL_TOKENS=$((SESSION_TOTAL_TOKENS + li + lo))
      ui_increment_usage "$li" "$lo" "$lc"
    fi
  fi
  return 0
}

# --- run_l1_sensitivity_check ---
# L1: Pure bash, no LLM, $0 cost.
# Builds VERIFIED_FILE_LIST via git and checks against SENSITIVE_PATHS.
# Sets: VERIFIED_FILE_LIST, L1_RESULT, L1_WARN_REASON, L1_FEEDBACK, L1_CONTEXT_BLOCK
run_l1_sensitivity_check() {
  VERIFIED_FILE_LIST=""
  L1_RESULT="clean"
  L1_WARN_REASON=""
  L1_FEEDBACK=""
  L1_CONTEXT_BLOCK=""

  local file_list=""
  local git_available=true

  # Collect files from all git states
  local unstaged staged branch_diff untracked
  unstaged=$(git diff --name-only 2>/dev/null) || git_available=false
  if [ "$git_available" = "true" ]; then
    staged=$(git diff --staged --name-only 2>/dev/null) || true
    # Try main, then master for branch diff
    branch_diff=$(git diff --name-only main...HEAD 2>/dev/null) || \
      branch_diff=$(git diff --name-only master...HEAD 2>/dev/null) || \
      { status_echo "  ⚠️  L1: Could not determine base branch for diff"; branch_diff=""; }
    untracked=$(git ls-files --others --exclude-standard 2>/dev/null) || true

    file_list=$(printf '%s\n%s\n%s\n%s' "$unstaged" "$staged" "$branch_diff" "$untracked" | \
      sed '/^$/d' | sort -u)
  fi

  if [ "$git_available" = "false" ]; then
    L1_RESULT="warn"
    L1_WARN_REASON="git detection unavailable"
    L1_FEEDBACK="[L1 — Sensitivity Check: WARN]
Git detection unavailable. Proceeding without verified file list."
    L1_CONTEXT_BLOCK="=== L1 CONTEXT ===
WARNING: Git detection unavailable. No verified file list.
=== END L1 CONTEXT ==="
    ui_set_agent_state l1 done "WARN" 0
    ui_write_value l1_tokens "0"
    status_echo "  ⚠️  L1: git detection unavailable"
    return 0
  fi

  if [ -z "$file_list" ]; then
    L1_RESULT="warn"
    L1_WARN_REASON="no changes detected"
    L1_FEEDBACK="[L1 — Sensitivity Check: WARN]
No file changes detected in working tree. L2 will evaluate whether
this is valid given the task description."
    L1_CONTEXT_BLOCK="=== L1 CONTEXT ===
WARNING: No file changes detected in working tree.
=== END L1 CONTEXT ==="
    ui_set_agent_state l1 done "WARN" 0
    ui_write_value l1_tokens "0"
    status_echo "  ⚠️  L1: no changes detected"
    return 0
  fi

  VERIFIED_FILE_LIST="$file_list"

  # Check for sensitive paths
  local sensitive_found=""
  local f sp
  while IFS= read -r f; do
    for sp in "${SENSITIVE_PATHS[@]}"; do
      if [[ "$f" == "$sp"* || "$f" == "$sp" ]]; then
        sensitive_found="${sensitive_found}${f}\n"
        break
      fi
    done
  done <<< "$VERIFIED_FILE_LIST"

  if [ -n "$sensitive_found" ]; then
    L1_RESULT="sensitive"
    L1_FEEDBACK="[L1 — Sensitivity Check: SENSITIVE]
Sensitive files detected:
$(echo -e "$sensitive_found" | sed '/^$/d')
Direct escalation to L4 governance review."
    L1_CONTEXT_BLOCK="=== L1 CONTEXT ===
VERIFIED FILE LIST:
$VERIFIED_FILE_LIST

SENSITIVE FILES DETECTED:
$(echo -e "$sensitive_found")
=== END L1 CONTEXT ==="
    ui_set_agent_state l1 done "SENSITIVE" 0
    ui_write_value l1_tokens "0"
    status_echo "  🔴 L1: sensitive files detected — escalating to L4"
    return 0
  fi

  L1_RESULT="clean"
  L1_FEEDBACK="[L1 — Sensitivity Check: PASS]
Verified files modified:
$VERIFIED_FILE_LIST
No sensitive paths detected."
  L1_CONTEXT_BLOCK="=== L1 CONTEXT ===
VERIFIED FILE LIST:
$VERIFIED_FILE_LIST

No sensitive paths detected.
=== END L1 CONTEXT ==="
  ui_set_agent_state l1 done "PASS" 0
  ui_write_value l1_tokens "0"
  status_echo "  ✅ L1: clean — $(echo "$VERIFIED_FILE_LIST" | wc -l | tr -d ' ') file(s) verified"
  return 0
}

# --- _build_governance_context ---
# Reads and formats governance files for injection into L4.
_build_governance_context() {
  local ctx="=== GOVERNANCE CONTEXT ==="
  ctx="$ctx
--- CLAUDE.md ---"
  if [ -f "$REPO_ROOT/CLAUDE.md" ]; then
    ctx="$ctx
$(cat "$REPO_ROOT/CLAUDE.md")"
  else
    ctx="$ctx
[CLAUDE.md not found]"
  fi
  ctx="$ctx
=== END GOVERNANCE CONTEXT ==="
  echo "$ctx"
}

# --- run_single_review ---
# Original single-reviewer behavior using fallback hierarchy.
# Sets REVIEW_OUTPUT and REVIEWER_COST. Sets PIPELINE_LAYERS="none".
run_single_review() {
  local review_prompt="$1"

  REVIEW_OUTPUT=""
  PIPELINE_LAYERS="none"

  while true; do
    get_active_reviewer

    if [ "$EXTREME_FALLBACK_ACTIVE" = "true" ]; then
      REVIEW_OUTPUT="SHIP"
      ui_set_agent_state l3 done "SHIP" 0
      ui_write_value l3_tokens "0"
      return 0
    elif [ "$ACTIVE_REVIEWER" = "claude-haiku" ]; then
      status_echo "⚠️  Using Claude self-review (haiku). External reviewers unavailable."
      if ! call_llm_delegate "openai-mini" "$review_prompt"; then
        REVIEW_OUTPUT="REVISE: fallback provider unavailable."
      fi
      if echo "$REVIEW_OUTPUT" | head -1 | grep -q "^SHIP"; then
        ui_set_agent_state l3 done "SHIP" 0
      else
        ui_set_agent_state l3 done "REVISE" 0
      fi
      ui_write_value l3_tokens "0"
      return 0
    elif [ "$ACTIVE_REVIEWER" = "claude-sonnet" ]; then
      status_echo "⚠️  Using Claude self-review (sonnet). External reviewers unavailable."
      if ! call_llm_delegate "openai-standard" "$review_prompt"; then
        REVIEW_OUTPUT="REVISE: fallback provider unavailable."
      fi
      if echo "$REVIEW_OUTPUT" | head -1 | grep -q "^SHIP"; then
        ui_set_agent_state l3 done "SHIP" 0
      else
        ui_set_agent_state l3 done "REVISE" 0
      fi
      ui_write_value l3_tokens "0"
      return 0
    fi

    # External reviewer via call_llm_delegate (handles cost guard + cost recording)
    if call_llm_delegate "$ACTIVE_REVIEWER" "$review_prompt"; then
      if echo "$REVIEW_OUTPUT" | head -1 | grep -q "^SHIP"; then
        ui_set_agent_state l3 done "SHIP" 0
      else
        ui_set_agent_state l3 done "REVISE" 0
      fi
      ui_write_value l3_tokens "$LAST_LLM_TOTAL_TOKENS"
      return 0
    fi

    # Blocked — block this provider and try the next in the fallback chain
    cost_guard_block_provider "$ACTIVE_REVIEWER"
  done
}

# call_layer_provider <layer_name> <chain_array_name> <prompt_var>
# Tries each provider in the chain until one succeeds.
# Sets REVIEW_OUTPUT and records cost (via call_llm_delegate).
# Sets LAYER_ACTIVE_PROVIDER to the provider that succeeded.
# Sets LAYER_FAILOVER_OCCURRED=true if a non-primary provider was used.
# Returns 0 on success, 1 if entire chain exhausted.
call_layer_provider() {
  local layer_name="$1"
  local -n _chain="$2"
  local prompt="$3"

  LAYER_ACTIVE_PROVIDER=""
  LAYER_FAILOVER_OCCURRED=false
  local primary_provider="${_chain[0]}"

  for provider in "${_chain[@]}"; do
    if cost_guard_is_blocked "$provider"; then
      continue
    fi

    if call_llm_delegate "$provider" "$prompt"; then
      LAYER_ACTIVE_PROVIDER="$provider"
      if [ "$provider" != "$primary_provider" ]; then
        LAYER_FAILOVER_OCCURRED=true
        local msg="${layer_name}: using $provider (primary $primary_provider unavailable)"
        status_echo "  ⚠️  Provider failover — $msg"
        if [ "$RALPH_PROVIDER_FAILOVER" = "pause" ]; then
          if [ "${RALPH_NON_INTERACTIVE:-}" = "1" ]; then
            status_echo "  [non-interactive: continuing automatically]"
          else
            status_echo "  Press ENTER to continue with $provider or Ctrl+C to abort."
            read -r
          fi
        fi
      fi
      return 0
    fi

    # Mark failed provider as blocked for this session
    cost_guard_block_provider "$provider"
  done

  return 1
}

# --- run_multilayer_review ---
# Progressive 4-layer review pipeline.
# L1 (bash, $0): sensitivity check — builds verified file list
# L2 (provider chain): protocol check — verifies worker claims against L1 data
# L3 (provider chain): quality review — judges substance
# L4 (claude-sonnet): governance review — escalation from L1 or L3
# Sets REVIEW_OUTPUT and REVIEWER_COST. Sets PIPELINE_LAYERS.
run_multilayer_review() {
  local task="$1"
  local work_summary="$2"
  local complete_claim="$3"
  local iteration="$4"
  local max_iter="$5"

  REVIEW_OUTPUT=""
  PIPELINE_LAYERS=""
  local consolidated_feedback=""

  # --- L1: Sensitivity Check (bash, $0) ---
  ui_set_agent_state l1 active "" 0
  status_echo "  🔒 L1 — Sensitivity check (bash, \$0)"
  run_l1_sensitivity_check
  consolidated_feedback="$L1_FEEDBACK"

  # If sensitive → skip L2+L3, go directly to L4
  if [ "$L1_RESULT" = "sensitive" ]; then
    ui_set_agent_state l2 skip "" 0
    ui_set_agent_state l3 skip "" 0
    ui_set_agent_state l4 active "" 0
    status_echo "  ⬆️  L1 → L4 direct escalation (sensitive files)"
    PIPELINE_LAYERS="L1→L4"

    local l4_prompt="You are the governance reviewer — the final authority in a Ralph Loop review pipeline.
L1 (sensitivity check) detected modifications to sensitive files and escalated directly to you.

TASK: $task
ITERATION: $iteration of $max_iter
WORKER SUMMARY: $work_summary
$complete_claim

$L1_CONTEXT_BLOCK

$(_build_governance_context)

Check:
1. Compliance with CLAUDE.md rules
2. Architectural layer boundaries preserved?
3. Guardrails authentic (not mocked or bypassed)?
4. Operator-facing behavior correct?
5. Scope discipline: does the work stay within the task scope?

Respond with EXACTLY one of:
SHIP
or
REVISE: [one paragraph of specific actionable feedback]"

    local l4_result
    if call_llm_delegate "openai-standard" "$l4_prompt"; then
      l4_result="$REVIEW_OUTPUT"
    else
      l4_result="REVISE: L4 provider unavailable."
    fi
    status_echo "  L4 result: $(echo "$l4_result" | head -1)"

    if echo "$l4_result" | head -1 | grep -q "^SHIP"; then
      ui_set_agent_state l4 done "SHIP" 0
      ui_write_value l4_tokens ""
      REVIEW_OUTPUT="SHIP"
    else
      local l4_feedback
      l4_feedback=$(echo "$l4_result" | sed 's/^REVISE:[[:space:]]*//')
      consolidated_feedback="$consolidated_feedback

[L4 — Governance Review: REVISE]
$l4_feedback"
      ui_set_agent_state l4 done "REVISE" 0
      ui_write_value l4_tokens ""
      REVIEW_OUTPUT="REVISE: $consolidated_feedback"
    fi
    return 0
  fi

  # --- L2: Protocol Check (provider chain) ---
  ui_set_agent_state l2 active "" 0
  status_echo "  📋 L2 — Protocol check (${L2_PROVIDER_CHAIN[0]})"
  local l2_prompt="You are a protocol check reviewer. Check ONLY these criteria:
1. The worker summary mentions running CI gates, OR the task does not require code changes
2. The files in the verified list below are consistent with the task scope (no obviously forbidden files modified)
3. The worker did not claim to modify files that are completely unrelated to the task

IMPORTANT: Do NOT fail because of CI output text, log content, or template literals in the summary.
Only fail if there is a clear protocol violation.

TASK: $task
ITERATION: $iteration of $max_iter
WORKER SUMMARY: $work_summary
$complete_claim

$L1_CONTEXT_BLOCK

Respond with EXACTLY one of:
PASS
or
FAIL: [one sentence explaining what protocol check failed]"

  if call_layer_provider "L2" L2_PROVIDER_CHAIN "$l2_prompt"; then
    PIPELINE_LAYERS="L1+L2"
    local l2_result="$REVIEW_OUTPUT"
    status_echo "  L2 result: $(echo "$l2_result" | head -1)"

    if echo "$l2_result" | head -1 | grep -q "^FAIL"; then
      local l2_feedback
      l2_feedback=$(echo "$l2_result" | sed 's/^FAIL:[[:space:]]*//')
      consolidated_feedback="$consolidated_feedback

[L2 — Protocol Check: FAIL]
$l2_feedback"
      local l2_fail_detail="FAIL"
      if [ "$LAYER_FAILOVER_OCCURRED" = "true" ]; then
        l2_fail_detail="FAIL [${LAYER_ACTIVE_PROVIDER} ↑ ${L2_PROVIDER_CHAIN[0]} unavailable]"
      fi
      ui_set_agent_state l2 done "$l2_fail_detail" 0
      ui_write_value l2_tokens "$LAST_LLM_TOTAL_TOKENS"
      REVIEW_OUTPUT="REVISE: $consolidated_feedback"
      return 0
    fi

    local l2_detail="PASS"
    if [ "$LAYER_FAILOVER_OCCURRED" = "true" ]; then
      l2_detail="PASS [${LAYER_ACTIVE_PROVIDER} ↑ ${L2_PROVIDER_CHAIN[0]} unavailable]"
    fi
    ui_set_agent_state l2 done "$l2_detail" 0
    ui_write_value l2_tokens "$LAST_LLM_TOTAL_TOKENS"
    consolidated_feedback="$consolidated_feedback

[L2 — Protocol Check: PASS]"
  else
    # L2 provider chain exhausted — degrading to single review
    ui_set_agent_state l2 done "BLOCKED" 0
    ui_write_value l2_tokens "0"
    status_echo "  ⚠️  L2 provider chain exhausted — degrading to single review"
    cost_guard_block_provider "${L2_PROVIDER_CHAIN[0]}"
    run_single_review "$( _build_single_review_prompt "$task" "$work_summary" "$complete_claim" "$iteration" "$max_iter" )"
    return 0
  fi

  # --- L3: Quality Review (provider chain) ---
  ui_set_agent_state l3 active "" 0
  status_echo "  🔍 L3 — Quality review (${L3_PROVIDER_CHAIN[0]})"

  # Count verified files for escalation trigger
  local file_count=0
  if [ -n "$VERIFIED_FILE_LIST" ]; then
    file_count=$(echo "$VERIFIED_FILE_LIST" | wc -l | tr -d ' ')
  fi

  local l3_prompt="You are a quality reviewer in a Ralph Loop review pipeline.

TASK: $task
ITERATION: $iteration of $max_iter
WORKER SUMMARY: $work_summary
$complete_claim

$L1_CONTEXT_BLOCK

Check:
1. Does the work match the task scope? No extra changes, no missing pieces.
2. Are there safety concerns? (command injection, XSS, SQL injection, etc.)
3. If code was changed, does the summary mention test results?
4. Is the work consistent with what the task asked for?

Respond with EXACTLY one of:
SHIP
or
REVISE: [one paragraph of specific actionable feedback]
or
ESCALATE: [one sentence explaining why governance review is needed]

ESCALATE when ANY of these apply:
- More than 5 files were modified (current count: $file_count)
- Changes affect architectural boundaries
- You are uncertain about compliance with architectural rules"

  if call_layer_provider "L3" L3_PROVIDER_CHAIN "$l3_prompt"; then
    PIPELINE_LAYERS="L1+L2+L3"
    local l3_result="$REVIEW_OUTPUT"
    status_echo "  L3 result: $(echo "$l3_result" | head -1)"

    if echo "$l3_result" | head -1 | grep -q "^SHIP"; then
      local l3_detail="SHIP"
      if [ "$LAYER_FAILOVER_OCCURRED" = "true" ]; then
        l3_detail="SHIP [${LAYER_ACTIVE_PROVIDER} ↑ ${L3_PROVIDER_CHAIN[0]} unavailable]"
      fi
      ui_set_agent_state l3 done "$l3_detail" 0
      ui_write_value l3_tokens "$LAST_LLM_TOTAL_TOKENS"
      REVIEW_OUTPUT="SHIP"
      return 0
    elif echo "$l3_result" | head -1 | grep -q "^ESCALATE"; then
      local escalation_reason
      escalation_reason=$(echo "$l3_result" | sed 's/^ESCALATE:[[:space:]]*//')
      local l3_escalate_detail="ESCALATE"
      if [ "$LAYER_FAILOVER_OCCURRED" = "true" ]; then
        l3_escalate_detail="ESCALATE [${LAYER_ACTIVE_PROVIDER} ↑ ${L3_PROVIDER_CHAIN[0]} unavailable]"
      fi
      ui_set_agent_state l3 done "$l3_escalate_detail" 0
      ui_write_value l3_tokens "$LAST_LLM_TOTAL_TOKENS"
      ui_set_agent_state l4 active "" 0
      status_echo "  ⬆️  Escalating to L4: $escalation_reason"
      consolidated_feedback="$consolidated_feedback

[L3 — Quality Review: ESCALATE]
$escalation_reason"
      # Fall through to L4
    elif echo "$l3_result" | head -1 | grep -q "^REVISE"; then
      local l3_feedback
      l3_feedback=$(echo "$l3_result" | sed 's/^REVISE:[[:space:]]*//')
      consolidated_feedback="$consolidated_feedback

[L3 — Quality Review: REVISE]
$l3_feedback"
      local l3_revise_detail="REVISE"
      if [ "$LAYER_FAILOVER_OCCURRED" = "true" ]; then
        l3_revise_detail="REVISE [${LAYER_ACTIVE_PROVIDER} ↑ ${L3_PROVIDER_CHAIN[0]} unavailable]"
      fi
      ui_set_agent_state l3 done "$l3_revise_detail" 0
      ui_write_value l3_tokens "$LAST_LLM_TOTAL_TOKENS"
      REVIEW_OUTPUT="REVISE: $consolidated_feedback"
      return 0
    else
      # Unknown response — treat as REVISE
      consolidated_feedback="$consolidated_feedback

[L3 — Quality Review: UNKNOWN]
$l3_result"
      local l3_unknown_detail="UNKNOWN"
      if [ "$LAYER_FAILOVER_OCCURRED" = "true" ]; then
        l3_unknown_detail="UNKNOWN [${LAYER_ACTIVE_PROVIDER} ↑ ${L3_PROVIDER_CHAIN[0]} unavailable]"
      fi
      ui_set_agent_state l3 done "$l3_unknown_detail" 0
      ui_write_value l3_tokens "$LAST_LLM_TOTAL_TOKENS"
      REVIEW_OUTPUT="REVISE: $consolidated_feedback"
      return 0
    fi
  else
    # L3 provider chain exhausted — degrading to single review
    ui_set_agent_state l3 done "BLOCKED" 0
    ui_write_value l3_tokens "0"
    status_echo "  ⚠️  L3 provider chain exhausted — degrading to single review"
    cost_guard_block_provider "${L3_PROVIDER_CHAIN[0]}"
    run_single_review "$( _build_single_review_prompt "$task" "$work_summary" "$complete_claim" "$iteration" "$max_iter" )"
    return 0
  fi

  # --- L4: Governance Review (claude-sonnet via claude -p) ---
  ui_set_agent_state l4 active "" 0
  status_echo "  🏛️  L4 — Governance review (claude-sonnet)"
  PIPELINE_LAYERS="L1+L2+L3+L4"

  local l4_prompt="You are the governance reviewer — the final authority in a Ralph Loop review pipeline.
L3 (quality review) escalated this review to you.

TASK: $task
ITERATION: $iteration of $max_iter
WORKER SUMMARY: $work_summary
$complete_claim

$L1_CONTEXT_BLOCK

$(_build_governance_context)

Check:
1. Compliance with CLAUDE.md rules
2. Architectural layer boundaries preserved?
3. Guardrails authentic (not mocked or bypassed)?
4. Operator-facing behavior correct?
5. Scope discipline: does the work stay within the task scope?

Respond with EXACTLY one of:
SHIP
or
REVISE: [one paragraph of specific actionable feedback]"

  local l4_result
  if call_llm_delegate "openai-standard" "$l4_prompt"; then
    l4_result="$REVIEW_OUTPUT"
  else
    l4_result="REVISE: L4 provider unavailable."
  fi
  status_echo "  L4 result: $(echo "$l4_result" | head -1)"

  if echo "$l4_result" | head -1 | grep -q "^SHIP"; then
    ui_set_agent_state l4 done "SHIP" 0
    ui_write_value l4_tokens ""
    REVIEW_OUTPUT="SHIP"
  else
    local l4_feedback
    l4_feedback=$(echo "$l4_result" | sed 's/^REVISE:[[:space:]]*//')
    consolidated_feedback="$consolidated_feedback

[L4 — Governance Review: REVISE]
$l4_feedback"
    ui_set_agent_state l4 done "REVISE" 0
    ui_write_value l4_tokens ""
    REVIEW_OUTPUT="REVISE: $consolidated_feedback"
  fi
  return 0
}

# --- _build_single_review_prompt ---
# Helper to build the standard single-review prompt.
_build_single_review_prompt() {
  local task="$1"
  local work_summary="$2"
  local complete_claim="$3"
  local iteration="$4"
  local max_iter="$5"

  echo "You are a strict code reviewer in a Ralph Loop.

CRITICAL RULE: If the worker's summary reports actual failures like 'permission denied', 'write blocked', 'cannot complete', 'all writes blocked', or 'permission not granted', you MUST respond with REVISE regardless of anything else. However, if these phrases appear in a negated context (e.g. 'no permission denied errors', 'did not encounter write blocked'), they indicate success and should NOT trigger REVISE.

TASK: $task
ITERATION: $iteration of $max_iter
WORKER SUMMARY: $work_summary
$complete_claim

Respond with EXACTLY one of:
SHIP
or
REVISE: [one paragraph of specific actionable feedback]

Rules:
- Reject incomplete work
- Reject if tests would fail
- Do NOT nitpick style if functionality is correct"
}

# --- MAIN LOOP ---
for (( i=1; i<=MAX_ITERATIONS; i++ )); do
  ITER_START_MS=$(date +%s%3N 2>/dev/null || date +%s000)
  ui_prepare_iteration "$i" "$MAX_ITERATIONS" "$(get_worker_ui_mode)"

  status_echo ""
  status_echo "───────────────────────────────────────────────────────────────"
  status_echo "  Iteration $i / $MAX_ITERATIONS — $(date +%H:%M:%S)"
  status_echo "───────────────────────────────────────────────────────────────"

  echo "$i" > "$RALPH_DIR/iteration.txt"

  # ── WORK PHASE ──
  WORK_START=$(date +%s)
  ui_set_agent_state worker active "" 0
  status_echo "▶ WORK PHASE ($(get_worker_display_name)) — started at $(date +%H:%M:%S)"
  status_echo "⏳ Working..."
  FEEDBACK=$(cat "$RALPH_DIR/review-feedback.txt" 2>/dev/null || echo "none")

  WORK_PROMPT="You are in a RALPH LOOP — iteration $i of $MAX_ITERATIONS.
Your memory lives in files only. Context resets each iteration.

STATE FILES in artifacts/bdralph/:
- task.md         → your task (READ FIRST)
- iteration.txt   → current iteration number
- review-feedback.txt → feedback from last review (address first)

YOUR JOBS:
1. cat artifacts/bdralph/task.md
2. cat artifacts/bdralph/review-feedback.txt 2>/dev/null || true
3. If feedback exists, address it specifically
4. Do the work following CLAUDE.md rules
5. Run CI gates if you changed code: npm test && npm run lint && npm run typecheck
6. Write summary: echo 'what you did' > artifacts/bdralph/work-summary.txt
7. If task fully complete: echo 'done' > artifacts/bdralph/work-complete.txt

Current feedback: ${FEEDBACK}

SAFETY CONSTRAINTS (mandatory, never violate):
- NEVER delete any existing file unless the task explicitly requires deletion
- NEVER modify .gitignore files
- NEVER modify CLAUDE.md
- NEVER modify files in src/loop/ directory (you are a worker, not a maintainer)
- Only create or modify files that are directly required by the task
- NEVER run 'git add artifacts/' or 'git add .' or 'git add -A' — always stage files explicitly by path
- NEVER commit artifacts/bdralph/ files — they are runtime state, not source code"

  WORKER_MODEL_FLAG=$(get_worker_model_flag)
  # shellcheck disable=SC2086
  if [ "${UI_STATE_ENABLED:-false}" = "true" ]; then
    echo "$WORK_PROMPT" | claude -p --dangerously-skip-permissions $WORKER_MODEL_FLAG > "$UI_WORKER_OUTPUT_FILE" 2>&1
  else
    echo "$WORK_PROMPT" | claude -p --dangerously-skip-permissions $WORKER_MODEL_FLAG
  fi
  WORK_END=$(date +%s)
  ui_set_agent_state worker done "done" "$((WORK_END - WORK_START))"
  ui_write_value worker_tokens ""
  ui_capture_worker_output_preview
  status_echo "✓ Work phase completed in $((WORK_END - WORK_START))s"

  # ── REVIEW PHASE ──
  REVIEW_START=$(date +%s)
  status_echo "▶ REVIEW PHASE ($REVIEWER_MODE mode) — started at $(date +%H:%M:%S)"
  status_echo "⏳ Reviewing..."
  WORK_SUMMARY=$(cat "$RALPH_DIR/work-summary.txt" 2>/dev/null || echo "No summary written")
  COMPLETE_CLAIM=""
  if [ -f "$RALPH_DIR/work-complete.txt" ]; then
    COMPLETE_CLAIM="WORKER CLAIMS TASK IS COMPLETE."
  fi

  REVIEWER_COST=0
  PIPELINE_LAYERS="none"

  if [ "$REVIEWER_MODE" = "pipeline" ]; then
    run_multilayer_review "$TASK" "$WORK_SUMMARY" "$COMPLETE_CLAIM" "$i" "$MAX_ITERATIONS"
  else
    # L1 runs ALWAYS — even in single mode
    ui_set_agent_state l1 active "" 0
    status_echo "  🔒 L1 — Sensitivity check (bash, \$0)"
    run_l1_sensitivity_check

    if [ "$L1_RESULT" = "sensitive" ]; then
      # Sensitive files → L4 governance review directly
      ui_set_agent_state l2 skip "" 0
      ui_set_agent_state l3 skip "" 0
      ui_set_agent_state l4 active "" 0
      status_echo "  ⬆️  L1 → L4 direct escalation (sensitive files)"
      PIPELINE_LAYERS="L1→L4"
      l4_single_prompt="You are the governance reviewer — the final authority in a Ralph Loop review pipeline.
L1 (sensitivity check) detected modifications to sensitive files and escalated directly to you.

TASK: $TASK
ITERATION: $i of $MAX_ITERATIONS
WORKER SUMMARY: $WORK_SUMMARY
$COMPLETE_CLAIM

$L1_CONTEXT_BLOCK

$(_build_governance_context)

Check:
1. Compliance with CLAUDE.md rules
2. Architectural layer boundaries preserved?
3. Guardrails authentic (not mocked or bypassed)?
4. Operator-facing behavior correct?
5. Scope discipline: does the work stay within the task scope?

Respond with EXACTLY one of:
SHIP
or
REVISE: [one paragraph of specific actionable feedback]"

      if ! call_llm_delegate "openai-standard" "$l4_single_prompt"; then
        REVIEW_OUTPUT="REVISE: L4 provider unavailable."
      fi
      if echo "$REVIEW_OUTPUT" | head -1 | grep -q "^SHIP"; then
        ui_set_agent_state l4 done "SHIP" 0
      else
        ui_set_agent_state l4 done "REVISE" 0
      fi
      ui_write_value l4_tokens ""
      status_echo "  L4 result: $(echo "$REVIEW_OUTPUT" | head -1)"
    else
      ui_set_agent_state l2 skip "" 0
      ui_set_agent_state l3 active "" 0
      REVIEW_PROMPT=$(_build_single_review_prompt "$TASK" "$WORK_SUMMARY" "$COMPLETE_CLAIM" "$i" "$MAX_ITERATIONS")
      run_single_review "$REVIEW_PROMPT"
      PIPELINE_LAYERS="L1+single"
    fi
  fi

  REVIEW_END=$(date +%s)
  status_echo "✓ Review phase completed in $((REVIEW_END - REVIEW_START))s"

  SESSION_TOTAL_COST=$(node -e "console.log(Math.round(($SESSION_TOTAL_COST + $REVIEWER_COST) * 1e9) / 1e9)")

  # ── PARSE RESULT ──
  RESULT="REVISE"
  FEEDBACK_TEXT=""
  if echo "$REVIEW_OUTPUT" | head -1 | grep -q "^SHIP"; then
    RESULT="SHIP"
  else
    FEEDBACK_TEXT=$(echo "$REVIEW_OUTPUT" | sed 's/^REVISE:[[:space:]]*//' | \
      tr -d '\000-\031' | sed 's/\\/\\\\/g; s/"/\\"/g' | tr '\n' ' ')
    echo "$FEEDBACK_TEXT" > "$RALPH_DIR/review-feedback.txt"
  fi

  # ── SHIP-ON-FAILURE GUARD ──
  # Script-level safety: reject SHIP if work summary contains failure indicators.
  # This is a hard guard independent of the reviewer's judgment.
  # Uses context-aware matching to avoid false positives from negated phrases
  # like "no permission denied errors" or "did not encounter write blocked".
  if [ "$RESULT" = "SHIP" ]; then
    WORK_SUMMARY_LOWER=$(echo "$WORK_SUMMARY" | tr '[:upper:]' '[:lower:]')
    FAILURE_DETECTED=false
    NEGATION_PATTERN='\b(no|not|never|without|zero|didn.t|don.t|doesn.t|wasn.t|weren.t|fixed|resolved|solved|handled|prevented|avoided|free of|free from|absence of)\b'
    for phrase in "permission denied" "write blocked" "cannot complete" "all writes blocked" "permission not granted"; do
      # Check if phrase exists at all
      if echo "$WORK_SUMMARY_LOWER" | grep -qF "$phrase"; then
        # Extract lines containing the phrase, then filter out lines where
        # the phrase is preceded by a negation word (within 60 chars)
        NON_NEGATED=$(echo "$WORK_SUMMARY_LOWER" | grep -F "$phrase" | grep -ivE "${NEGATION_PATTERN}.{0,20}${phrase}" || true)
        if [ -n "$NON_NEGATED" ]; then
          FAILURE_DETECTED=true
          break
        fi
      fi
    done
    if [ "$FAILURE_DETECTED" = "true" ]; then
      status_echo "⚠️  SHIP-ON-FAILURE GUARD: Work summary contains failure indicators. Overriding SHIP → REVISE."
      RESULT="REVISE"
      FEEDBACK_TEXT="[AUTOMATED] Worker reported failure (permission denied, write blocked, etc.). Task not completed. Retry with corrected approach."
      echo "$FEEDBACK_TEXT" > "$RALPH_DIR/review-feedback.txt"
    fi
  fi

  # ── AUTO-ESCALATION TRACKING ──
  if [ "$WORKER" = "auto" ]; then
    if [ "$RESULT" = "REVISE" ]; then
      CONSECUTIVE_REVISES=$((CONSECUTIVE_REVISES + 1))
      if [ "$CONSECUTIVE_REVISES" -ge "$ESCALATE_AFTER" ] && [ "$WORKER_ESCALATED" = "false" ]; then
        WORKER_ESCALATED=true
        ui_write_value worker_mode "$(get_worker_ui_mode)"
        status_echo "⚡ AUTO-ESCALATION: Switching worker to claude-opus-4-6 after $CONSECUTIVE_REVISES consecutive REVISE(s)"
      fi
    else
      CONSECUTIVE_REVISES=0
    fi
  fi

  echo "$RESULT" > "$RALPH_DIR/review-result.txt"

  ITER_END_MS=$(date +%s%3N 2>/dev/null || date +%s000)
  DURATION_MS=$((ITER_END_MS - ITER_START_MS))

  # ── LOG ──
  TASK_JSON=$(echo "$TASK" | head -c 200 | node -e "process.stdout.write(JSON.stringify(require('fs').readFileSync('/dev/stdin','utf8')))")
  FEEDBACK_JSON=$(echo "$FEEDBACK_TEXT" | node -e "process.stdout.write(JSON.stringify(require('fs').readFileSync('/dev/stdin','utf8')))")
  node -e "
    const entry = {
      session: '$SESSION_ID',
      timestamp: new Date().toISOString(),
      task: $TASK_JSON,
      iteration: $i,
      max_iterations: $MAX_ITERATIONS,
      worker: '$(get_worker_display_name)',
      worker_mode: '$WORKER',
      worker_escalated: $( [ "$WORKER_ESCALATED" = "true" ] && echo "true" || echo "false" ),
      reviewer: '$( [ "$REVIEWER_MODE" = "pipeline" ] && echo "pipeline" || echo "${ACTIVE_REVIEWER:-$REVIEWER}" )',
      reviewer_mode: '$REVIEWER_MODE',
      pipeline_layers: '$PIPELINE_LAYERS',
      result: '$RESULT',
      feedback: $FEEDBACK_JSON,
      duration_ms: $DURATION_MS,
      reviewer_cost_usd: $REVIEWER_COST,
      session_total_cost_usd: $SESSION_TOTAL_COST
    };
    require('fs').appendFileSync('$LOGS_DIR/iteration_report.jsonl', JSON.stringify(entry) + '\n');
  "

  # ── ON SHIP ──
  if [ "$RESULT" = "SHIP" ]; then
    if [ "${UI_STATE_ENABLED:-false}" = "true" ]; then
      ui_show_banner "✓ SHIPPED" "$i iterations  •  $(ui_format_duration "$(ui_read_value session_elapsed "0")")  •  \$$(ui_read_value total_cost "$SESSION_TOTAL_COST")"
    else
      echo ""
      echo "═══════════════════════════════════════════════════════════════"
      echo "  ✓ SHIPPED after $i iteration(s)"
      echo "  💰 Reviewer cost this session: \$$SESSION_TOTAL_COST"
      echo "═══════════════════════════════════════════════════════════════"
    fi

    echo "COMPLETE: $(date -Iseconds)" > "$RALPH_DIR/.bdralph-complete"
    if [ "${UI_STATE_ENABLED:-false}" != "true" ]; then
      ensure_cost_guard_session
      cost_guard_status
    fi

    if [ "$i" -gt 3 ]; then
      cat >> "$LOGS_DIR/improvement_suggestions.md" <<EOF

## $(date -Iseconds) [session: $SESSION_ID] — Completed in $i iterations
Task: $TASK
Reviewer cost: \$$SESSION_TOTAL_COST
Suggestion: task may have been too broad. Consider breaking into smaller objectives.
EOF
    fi

    exit 0
  fi

  if [ "${UI_STATE_ENABLED:-false}" = "true" ]; then
    ui_show_banner "↻ REVISE" "feedback saved"
    sleep 1
  fi

done

# ── ON MAX ITERATIONS REACHED ──
if [ "${UI_STATE_ENABLED:-false}" = "true" ]; then
  ui_show_banner "✗ BLOCKED" "max iterations reached"
else
  echo ""
  echo "✗ Max iterations ($MAX_ITERATIONS) reached — BLOCKED"
  echo "  💰 Total reviewer cost: \$$SESSION_TOTAL_COST"
fi

cat >> "$LOGS_DIR/improvement_suggestions.md" <<EOF

## $(date -Iseconds) [session: $SESSION_ID] — BLOCKED after $MAX_ITERATIONS iterations
Task: $TASK
Reviewer cost: \$$SESSION_TOTAL_COST
Suggestion: decompose the task or clarify success criteria.
EOF

if [ "${UI_STATE_ENABLED:-false}" != "true" ]; then
  ensure_cost_guard_session
  cost_guard_status
fi

# --- ink renderer cleanup ---
if [ "$RALPH_INK_ACTIVE" = "true" ] && [ -n "$INK_RENDERER_PID" ]; then
  kill "$INK_RENDERER_PID" 2>/dev/null || true
  wait "$INK_RENDERER_PID" 2>/dev/null || true
fi
exit 1
