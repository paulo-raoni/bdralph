#!/bin/bash
set -euo pipefail

# ─── Provider Registry ───────────────────────────────────────────────────────
# Provider names are SEMANTIC — decoupled from model IDs.
# To upgrade a model: change ONLY the model ID in the API call below.
# To add a provider: add an elif block following the existing pattern.
#
# Provider Name      → Model ID            → API
# openai-mini        → gpt-4o-mini         → OpenAI Chat Completions
# openai-cheap       → gpt-5.4-nano        → OpenAI Chat Completions
# openai-standard    → gpt-5.4-mini        → OpenAI Chat Completions
# gemini-flash       → gemini-2.5-flash    → Google Generative Language
# ─────────────────────────────────────────────────────────────────────────────

PROVIDER="${1:-}"
PROMPT="${2:-}"

if [ -z "$PROVIDER" ] || [ -z "$PROMPT" ]; then
  echo "Usage: $0 <provider> <prompt>" >&2
  echo "Providers: openai-mini, openai-cheap, openai-standard, gemini-flash" >&2
  exit 1
fi

# Verify node is available (required for JSON escaping)
if ! command -v node &> /dev/null; then
  echo "ERROR: node is required but not found in PATH" >&2
  exit 1
fi

json_escape() {
  echo "$1" | node -e "const s=require('fs').readFileSync('/dev/stdin','utf8'); process.stdout.write(JSON.stringify(s))"
}

USAGE_FILE="/tmp/llm_delegate_usage.json"

write_usage() {
  local provider="$1"
  local input_price_per_m="$2"
  local output_price_per_m="$3"
  local input_path="$4"
  local output_path="$5"
  node -e "
    const d = require('/tmp/llm_response.json');
    const inp = Number(d${input_path}) || 0;
    const out = Number(d${output_path}) || 0;
    const cost = (inp * ${input_price_per_m} + out * ${output_price_per_m}) / 1e6;
    const usage = {
      provider: '${provider}',
      input_tokens: inp,
      output_tokens: out,
      cost_usd: Math.round(cost * 1e9) / 1e9
    };
    require('fs').writeFileSync('${USAGE_FILE}', JSON.stringify(usage, null, 2) + '\n');
  "
}

if [ "$PROVIDER" = "openai-mini" ]; then
  if [ -z "${OPENAI_API_KEY:-}" ]; then
    echo "ERROR: OPENAI_API_KEY is not set" >&2
    exit 1
  fi
  HTTP_STATUS=$(curl -s -o /tmp/llm_response.json -w "%{http_code}" \
    --max-time 30 \
    https://api.openai.com/v1/chat/completions \
    -H "Authorization: Bearer $OPENAI_API_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"model\":\"gpt-4o-mini\",\"messages\":[{\"role\":\"user\",\"content\":$(json_escape "$PROMPT")}]}")
  if [ "$HTTP_STATUS" != "200" ]; then
    echo "ERROR: OpenAI API returned HTTP $HTTP_STATUS" >&2
    cat /tmp/llm_response.json >&2
    exit 1
  fi
  node -e "const d=require('/tmp/llm_response.json'); process.stdout.write(d.choices[0].message.content)"
  write_usage "openai-mini" "0.15" "0.60" ".usage.prompt_tokens" ".usage.completion_tokens"

elif [ "$PROVIDER" = "openai-cheap" ]; then
  if [ -z "${OPENAI_API_KEY:-}" ]; then
    echo "ERROR: OPENAI_API_KEY is not set" >&2
    exit 1
  fi
  HTTP_STATUS=$(curl -s -o /tmp/llm_response.json -w "%{http_code}" \
    --max-time 30 \
    https://api.openai.com/v1/chat/completions \
    -H "Authorization: Bearer $OPENAI_API_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"model\":\"gpt-5.4-nano\",\"messages\":[{\"role\":\"user\",\"content\":$(json_escape "$PROMPT")}]}")
  if [ "$HTTP_STATUS" != "200" ]; then
    echo "ERROR: OpenAI API returned HTTP $HTTP_STATUS" >&2
    cat /tmp/llm_response.json >&2
    exit 1
  fi
  node -e "const d=require('/tmp/llm_response.json'); process.stdout.write(d.choices[0].message.content)"
  write_usage "openai-cheap" "0.10" "0.625" ".usage.prompt_tokens" ".usage.completion_tokens"

elif [ "$PROVIDER" = "openai-standard" ]; then
  if [ -z "${OPENAI_API_KEY:-}" ]; then
    echo "ERROR: OPENAI_API_KEY is not set" >&2
    exit 1
  fi
  HTTP_STATUS=$(curl -s -o /tmp/llm_response.json -w "%{http_code}" \
    --max-time 30 \
    https://api.openai.com/v1/chat/completions \
    -H "Authorization: Bearer $OPENAI_API_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"model\":\"gpt-5.4-mini\",\"messages\":[{\"role\":\"user\",\"content\":$(json_escape "$PROMPT")}]}")
  if [ "$HTTP_STATUS" != "200" ]; then
    echo "ERROR: OpenAI API returned HTTP $HTTP_STATUS" >&2
    cat /tmp/llm_response.json >&2
    exit 1
  fi
  node -e "const d=require('/tmp/llm_response.json'); process.stdout.write(d.choices[0].message.content)"
  write_usage "openai-standard" "0.375" "2.25" ".usage.prompt_tokens" ".usage.completion_tokens"

# gemini-flash -> gemini-2.5-flash (to upgrade: change only the model ID in the URL below)
elif [ "$PROVIDER" = "gemini-flash" ]; then
  if [ -z "${GOOGLE_API_KEY:-}" ]; then
    echo "ERROR: GOOGLE_API_KEY is not set" >&2
    exit 1
  fi
  HTTP_STATUS=$(curl -s -o /tmp/llm_response.json -w "%{http_code}" \
    --max-time 30 \
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent" \
    -H "x-goog-api-key: $GOOGLE_API_KEY" \
    -H "Content-Type: application/json" \
    -X POST \
    -d "{\"contents\":[{\"parts\":[{\"text\":$(json_escape "$PROMPT")}]}]}")
  if [ "$HTTP_STATUS" != "200" ]; then
    echo "ERROR: Gemini API returned HTTP $HTTP_STATUS" >&2
    cat /tmp/llm_response.json >&2
    # Fallback hint
    echo "HINT: If model not found, try gemini-1.5-flash as fallback" >&2
    exit 1
  fi
  node -e "const d=require('/tmp/llm_response.json'); process.stdout.write(d.candidates[0].content.parts[0].text)"
  write_usage "gemini-flash" "0.30" "2.50" ".usageMetadata.promptTokenCount" ".usageMetadata.candidatesTokenCount"

else
  echo "ERROR: Unknown provider '$PROVIDER'. Use: openai-mini, openai-cheap, openai-standard, gemini-flash" >&2
  exit 1
fi

# Cleanup
rm -f /tmp/llm_response.json
