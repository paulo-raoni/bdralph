#!/bin/bash
# Mock LLM delegate — returns MOCK_LLM_RESPONSE (default: PASS).
# Writes minimal usage JSON to /tmp/llm_delegate_usage.json.
RESPONSE="${MOCK_LLM_RESPONSE:-PASS}"
echo "$RESPONSE"
if [ -n "${MOCK_LLM_CLASSIFICATION:-}" ]; then
  echo "CLASSIFICATION: ${MOCK_LLM_CLASSIFICATION}"
fi
node -e "
  require('fs').writeFileSync('/tmp/llm_delegate_usage.json',
    JSON.stringify({ input_tokens: 10, output_tokens: 5, cost_usd: 0.0001 }) + '\n'
  );
" 2>/dev/null || true
