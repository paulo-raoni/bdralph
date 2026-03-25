#!/bin/bash
# cost-guard.sh — Cost protection layer for LLM delegation calls.
# Sourceable library: source src/loop/cost-guard.sh
# Uses node for all JSON reading/writing and arithmetic.

COST_GUARD_SESSION_FILE="/tmp/cost_guard_session.json"
COST_GUARD_AUDIT_FILE="/tmp/cost_guard_audit.jsonl"

# --- cost_guard_init ---
# Initializes a session. Resets accumulated cost to zero.
cost_guard_init() {
  local enabled="${LLM_COST_GUARD_ENABLED:-true}"
  local max_execution="${LLM_MAX_EXECUTION_COST_USD:-0.50}"
  local max_call="${LLM_MAX_CALL_COST_USD:-0.10}"

  node -e "
    const session = {
      accumulated_usd: 0,
      max_execution_usd: ${max_execution},
      max_call_usd: ${max_call},
      enabled: ${enabled},
      calls: [],
      blocked_providers: []
    };
    require('fs').writeFileSync('${COST_GUARD_SESSION_FILE}', JSON.stringify(session, null, 2) + '\n');
  "
  # Clear audit log for new session
  : > "$COST_GUARD_AUDIT_FILE"
}

# --- _cost_guard_estimate ---
# Internal: calculates estimated cost for a provider call.
# Returns cost via stdout.
_cost_guard_estimate() {
  local provider="$1"
  local input_tokens="$2"
  local output_tokens="$3"

  node -e "
    const pricing = {
      'openai-mini':     { input: 0.15,  output: 0.60  },
      'openai-cheap':    { input: 0.10,  output: 0.625 },
      'openai-standard': { input: 0.375, output: 2.25  },
      'gemini-flash':    { input: 0.30,  output: 2.50  },
      'claude-haiku':    { input: 0.00,  output: 0.00  },
      'claude-sonnet':   { input: 0.00,  output: 0.00  }
    };
    const p = pricing['${provider}'];
    if (!p) {
      console.log('UNKNOWN');
      process.exit(0);
    }
    const cost = (${input_tokens} * p.input + ${output_tokens} * p.output) / 1e6;
    console.log(Math.round(cost * 1e9) / 1e9);
  "
}

# --- _cost_guard_audit ---
# Internal: appends an entry to the audit log.
_cost_guard_audit() {
  local provider="$1"
  local status="$2"
  local reason="$3"
  local estimated_cost="$4"
  local accumulated="$5"
  local limit="$6"

  node -e "
    const entry = {
      timestamp: new Date().toISOString(),
      provider: '${provider}',
      status: '${status}',
      reason: $(node -e "process.stdout.write(JSON.stringify('${reason}'))"),
      estimated_cost_usd: ${estimated_cost},
      accumulated_usd: ${accumulated},
      limit_usd: ${limit}
    };
    require('fs').appendFileSync('${COST_GUARD_AUDIT_FILE}', JSON.stringify(entry) + '\n');
  "
}

# --- cost_guard_check ---
# Checks if a call is allowed BEFORE making it.
# Returns exit code 0 if allowed, 1 if blocked.
cost_guard_check() {
  local provider="${1:-}"
  local input_tokens="${2:-0}"
  local output_tokens="${3:-0}"

  # Read enabled flag from session
  local enabled
  enabled=$(node -e "const s = JSON.parse(require('fs').readFileSync('${COST_GUARD_SESSION_FILE}','utf8')); console.log(s.enabled !== undefined ? s.enabled : true)")

  # If guard disabled, always allow
  if [ "$enabled" = "false" ]; then
    local est
    est=$(_cost_guard_estimate "$provider" "$input_tokens" "$output_tokens")
    [ "$est" = "UNKNOWN" ] && est=0
    local acc
    acc=$(node -e "const s = JSON.parse(require('fs').readFileSync('${COST_GUARD_SESSION_FILE}','utf8')); console.log(s.accumulated_usd)")
    local limit
    limit=$(node -e "const s = JSON.parse(require('fs').readFileSync('${COST_GUARD_SESSION_FILE}','utf8')); console.log(s.max_execution_usd)")
    _cost_guard_audit "$provider" "allowed" "guard disabled" "$est" "$acc" "$limit"
    return 0
  fi

  # Check if provider is blocked
  local is_blocked
  is_blocked=$(node -e "
    const s = JSON.parse(require('fs').readFileSync('${COST_GUARD_SESSION_FILE}','utf8'));
    console.log((s.blocked_providers || []).includes('${provider}'));
  ")
  if [ "$is_blocked" = "true" ]; then
    local acc
    acc=$(node -e "const s = JSON.parse(require('fs').readFileSync('${COST_GUARD_SESSION_FILE}','utf8')); console.log(s.accumulated_usd)")
    local limit
    limit=$(node -e "const s = JSON.parse(require('fs').readFileSync('${COST_GUARD_SESSION_FILE}','utf8')); console.log(s.max_execution_usd)")
    _cost_guard_audit "$provider" "blocked_by_cost_guard" "provider blocked" "0" "$acc" "$limit"
    return 1
  fi

  # Estimate cost
  local estimated
  estimated=$(_cost_guard_estimate "$provider" "$input_tokens" "$output_tokens")

  # Fail closed on unknown provider
  if [ "$estimated" = "UNKNOWN" ]; then
    local acc
    acc=$(node -e "const s = JSON.parse(require('fs').readFileSync('${COST_GUARD_SESSION_FILE}','utf8')); console.log(s.accumulated_usd)")
    local limit
    limit=$(node -e "const s = JSON.parse(require('fs').readFileSync('${COST_GUARD_SESSION_FILE}','utf8')); console.log(s.max_execution_usd)")
    _cost_guard_audit "$provider" "blocked_by_cost_guard" "unknown provider: ${provider}" "0" "$acc" "$limit"
    return 1
  fi

  # Check limits
  node -e "
    const s = JSON.parse(require('fs').readFileSync('${COST_GUARD_SESSION_FILE}','utf8'));
    const est = ${estimated};
    const acc = s.accumulated_usd;
    const maxCall = s.max_call_usd;
    const maxExec = s.max_execution_usd;

    if (est > maxCall) {
      process.exit(2); // per-call limit exceeded
    }
    if (acc + est > maxExec) {
      process.exit(3); // execution budget exceeded
    }
    process.exit(0);
  "
  local check_result=$?

  local acc
  acc=$(node -e "const s = JSON.parse(require('fs').readFileSync('${COST_GUARD_SESSION_FILE}','utf8')); console.log(s.accumulated_usd)")
  local limit
  limit=$(node -e "const s = JSON.parse(require('fs').readFileSync('${COST_GUARD_SESSION_FILE}','utf8')); console.log(s.max_execution_usd)")

  if [ "$check_result" -eq 2 ]; then
    local max_call
    max_call=$(node -e "const s = JSON.parse(require('fs').readFileSync('${COST_GUARD_SESSION_FILE}','utf8')); console.log(s.max_call_usd)")
    _cost_guard_audit "$provider" "blocked_by_cost_guard" "per-call cost \$${estimated} exceeds limit \$${max_call}" "$estimated" "$acc" "$limit"
    return 1
  fi

  if [ "$check_result" -eq 3 ]; then
    _cost_guard_audit "$provider" "blocked_by_cost_guard" "accumulated + estimated exceeds execution budget" "$estimated" "$acc" "$limit"
    return 1
  fi

  _cost_guard_audit "$provider" "allowed" "" "$estimated" "$acc" "$limit"
  return 0
}

# --- cost_guard_record ---
# Called AFTER a successful call to record real cost.
cost_guard_record() {
  local provider="${1:-}"
  local input_tokens="${2:-0}"
  local output_tokens="${3:-0}"

  local cost
  cost=$(_cost_guard_estimate "$provider" "$input_tokens" "$output_tokens")
  [ "$cost" = "UNKNOWN" ] && cost=0

  node -e "
    const fs = require('fs');
    const s = JSON.parse(fs.readFileSync('${COST_GUARD_SESSION_FILE}','utf8'));
    const cost = ${cost};
    s.accumulated_usd = Math.round((s.accumulated_usd + cost) * 1e9) / 1e9;
    s.calls.push({
      provider: '${provider}',
      input_tokens: ${input_tokens},
      output_tokens: ${output_tokens},
      cost_usd: cost,
      timestamp: new Date().toISOString()
    });
    fs.writeFileSync('${COST_GUARD_SESSION_FILE}', JSON.stringify(s, null, 2) + '\n');
  "

  local acc
  acc=$(node -e "const s = JSON.parse(require('fs').readFileSync('${COST_GUARD_SESSION_FILE}','utf8')); console.log(s.accumulated_usd)")
  local limit
  limit=$(node -e "const s = JSON.parse(require('fs').readFileSync('${COST_GUARD_SESSION_FILE}','utf8')); console.log(s.max_execution_usd)")

  _cost_guard_audit "$provider" "recorded" "" "$cost" "$acc" "$limit"
}

# --- cost_guard_status ---
# Prints current session summary.
cost_guard_status() {
  node -e "
    const s = JSON.parse(require('fs').readFileSync('${COST_GUARD_SESSION_FILE}','utf8'));
    const remaining = Math.round((s.max_execution_usd - s.accumulated_usd) * 1e9) / 1e9;
    console.log('Cost Guard Status:');
    console.log('  Enabled:        ' + s.enabled);
    console.log('  Accumulated:    \$' + s.accumulated_usd.toFixed(6));
    console.log('  Remaining:      \$' + remaining.toFixed(6));
    console.log('  Exec limit:     \$' + s.max_execution_usd.toFixed(2));
    console.log('  Per-call limit: \$' + s.max_call_usd.toFixed(2));
    console.log('  Calls made:     ' + s.calls.length);
  "
}

# --- cost_guard_block_provider ---
# Marks a provider as blocked for this session.
cost_guard_block_provider() {
  local provider="${1:-}"
  node -e "
    const fs = require('fs');
    const s = JSON.parse(fs.readFileSync('${COST_GUARD_SESSION_FILE}','utf8'));
    if (!s.blocked_providers) s.blocked_providers = [];
    if (!s.blocked_providers.includes('${provider}')) {
      s.blocked_providers.push('${provider}');
    }
    fs.writeFileSync('${COST_GUARD_SESSION_FILE}', JSON.stringify(s, null, 2) + '\n');
  "
}

# --- cost_guard_is_blocked ---
# Returns exit code 0 if provider is blocked, 1 if not.
cost_guard_is_blocked() {
  local provider="${1:-}"
  local blocked
  blocked=$(node -e "
    const s = JSON.parse(require('fs').readFileSync('${COST_GUARD_SESSION_FILE}','utf8'));
    console.log((s.blocked_providers || []).includes('${provider}'));
  ")
  if [ "$blocked" = "true" ]; then
    return 0
  fi
  return 1
}
