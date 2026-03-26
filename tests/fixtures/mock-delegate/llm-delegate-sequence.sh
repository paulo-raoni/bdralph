#!/bin/bash
# Mock LLM delegate — reads responses from MOCK_SEQUENCE_FILE line by line.
# Consumes one line per invocation. Falls back to PASS when exhausted.
SEQUENCE_FILE="${MOCK_SEQUENCE_FILE:-}"
RESPONSE="PASS"
if [ -n "$SEQUENCE_FILE" ] && [ -f "$SEQUENCE_FILE" ]; then
  RESPONSE=$(head -1 "$SEQUENCE_FILE")
  tail -n +2 "$SEQUENCE_FILE" > "${SEQUENCE_FILE}.tmp" && mv "${SEQUENCE_FILE}.tmp" "$SEQUENCE_FILE"
fi
[ -z "$RESPONSE" ] && RESPONSE="PASS"
echo "$RESPONSE"
node -e "
  require('fs').writeFileSync('/tmp/llm_delegate_usage.json',
    JSON.stringify({ input_tokens: 10, output_tokens: 5, cost_usd: 0.0001 }) + '\n'
  );
" 2>/dev/null || true
