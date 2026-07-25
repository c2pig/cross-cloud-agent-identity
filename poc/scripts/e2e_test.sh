#!/usr/bin/env bash
#
# End-to-end POC test: happy path + three negative cases (front-door auth,
# ingress gateway, egress gateway). Requires .env to be sourced or the
# equivalent variables exported: AUTH0_*, FRONTDOOR_URL, GCP_PROJECT_ID,
# GCP_LOCATION, REASONING_ENGINE_ID, GATEWAY_MCP_URL.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

: "${FRONTDOOR_URL:?set FRONTDOOR_URL}"
: "${GCP_PROJECT_ID:?set GCP_PROJECT_ID}"
: "${GCP_LOCATION:?set GCP_LOCATION}"
: "${REASONING_ENGINE_ID:?set REASONING_ENGINE_ID}"

PASS=0
FAIL=0

pass() { echo "PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "FAIL: $1"; FAIL=$((FAIL + 1)); }

echo "=== Step 1: get Auth0 JWT ==="
AUTH0_JWT=$("${SCRIPT_DIR}/get_auth0_token.sh")
echo "Got Auth0 JWT (length ${#AUTH0_JWT})"

echo ""
echo "=== Step 2: call the Cloud Run front door ==="
RESPONSE=$(curl -s -w '\n%{http_code}' -H "Authorization: Bearer ${AUTH0_JWT}" \
  -H "Content-Type: application/json" \
  -d '{"message": "hi"}' \
  "${FRONTDOOR_URL}/chat")
HTTP_CODE=$(echo "${RESPONSE}" | tail -n1)
BODY=$(echo "${RESPONSE}" | sed '$d')

echo "=== Step 3: response ==="
echo "${BODY}" | jq . || echo "${BODY}"

if [ "${HTTP_CODE}" = "200" ] && echo "${BODY}" | jq -e '.gcp_response' >/dev/null 2>&1; then
  pass "happy path returned HTTP 200 with a body"
else
  fail "happy path expected HTTP 200, got ${HTTP_CODE}"
fi

CORR_ID=$(echo "${BODY}" | jq -r '.correlation_id // empty')
echo "correlation_id=${CORR_ID}"

echo ""
echo "=== Step 4: manual follow-up commands (not auto-executed) ==="
echo "Cloud Trace: gcloud trace list-traces --project=${GCP_PROJECT_ID} --filter=\"span:${CORR_ID}\""
echo "Cloud Logging: gcloud logging read 'jsonPayload.correlation_id=\"${CORR_ID}\"' --project=${GCP_PROJECT_ID}"
echo "CloudWatch / AgentCore Observability: search for correlation_id=${CORR_ID} in the AgentCore Gateway's observability console/log group."

echo ""
echo "=== Negative case A: tampered/expired JWT rejected by front door ==="
TAMPERED_JWT="${AUTH0_JWT}tampered"
NEG_A_CODE=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer ${TAMPERED_JWT}" \
  -H "Content-Type: application/json" \
  -d '{"message": "hi"}' \
  "${FRONTDOOR_URL}/chat")
if [ "${NEG_A_CODE}" = "401" ]; then
  pass "tampered JWT rejected with HTTP 401"
else
  fail "expected HTTP 401 for tampered JWT, got ${NEG_A_CODE}"
fi

echo ""
echo "=== Negative case B: ingress gateway denies non-front-door caller ==="
QUERY_URL="https://${GCP_LOCATION}-aiplatform.googleapis.com/v1/projects/${GCP_PROJECT_ID}/locations/${GCP_LOCATION}/reasoningEngines/${REASONING_ENGINE_ID}:query"
CALLER_TOKEN=$(gcloud auth print-identity-token 2>/dev/null || true)
if [ -z "${CALLER_TOKEN}" ]; then
  echo "SKIP: no local gcloud identity token available to use as the non-front-door caller"
else
  NEG_B_CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST \
    -H "Authorization: Bearer ${CALLER_TOKEN}" \
    -H "Content-Type: application/json" \
    -d '{"input": {"message": "hi"}}' \
    "${QUERY_URL}")
  if [ "${NEG_B_CODE}" = "403" ]; then
    pass "direct call from non-front-door identity denied at ingress gateway (HTTP 403)"
  else
    fail "expected HTTP 403 from ingress gateway, got ${NEG_B_CODE}"
  fi
  echo "Confirm denial was recorded: check the Agent Gateway Observability tab (Authorization failures) in the GCP console for project ${GCP_PROJECT_ID}."
fi

echo ""
echo "=== Negative case C: egress gateway denies unregistered destination ==="
echo "This case requires temporarily repointing the agent's GATEWAY_MCP_URL env var at an"
echo "unregistered endpoint, re-running the happy path, observing the egress denial, then reverting."
echo ""
echo "Example (run manually, NOT auto-executed by this script):"
echo "  gcloud ai reasoning-engines update ${REASONING_ENGINE_ID} \\"
echo "    --region=${GCP_LOCATION} \\"
echo "    --update-env-vars=GATEWAY_MCP_URL=https://example.invalid/mcp"
echo "  # re-run step 2 above, expect the agent's aws_response to show an egress denial"
echo "  # then check the Agent Gateway Observability tab (egress: unregistered-destination denials)"
echo "  gcloud ai reasoning-engines update ${REASONING_ENGINE_ID} \\"
echo "    --region=${GCP_LOCATION} \\"
echo "    --update-env-vars=GATEWAY_MCP_URL=${GATEWAY_MCP_URL:-<original value>}"
echo ""
echo "This case is left manual because flipping a live registry-backed destination and reverting"
echo "it automatically risks leaving the agent misconfigured if the script is interrupted."

echo ""
echo "=== Summary: ${PASS} passed, ${FAIL} failed ==="
if [ "${FAIL}" -gt 0 ]; then
  exit 1
fi
