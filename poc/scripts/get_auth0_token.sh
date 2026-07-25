#!/usr/bin/env bash
#
# Auth0 Resource Owner Password Grant — POC-only, never use in production.
# Outputs the id_token to stdout so callers can capture it, e.g.:
#   AUTH0_JWT=$(./get_auth0_token.sh)
set -euo pipefail

: "${AUTH0_DOMAIN:?set AUTH0_DOMAIN}"
: "${AUTH0_AUDIENCE:?set AUTH0_AUDIENCE}"
: "${AUTH0_CLIENT_ID:?set AUTH0_CLIENT_ID}"
: "${AUTH0_CLIENT_SECRET:?set AUTH0_CLIENT_SECRET}"
: "${AUTH0_TEST_USERNAME:?set AUTH0_TEST_USERNAME}"
: "${AUTH0_TEST_PASSWORD:?set AUTH0_TEST_PASSWORD}"

RESPONSE=$(curl -s --request POST \
  --url "https://${AUTH0_DOMAIN}/oauth/token" \
  --header 'content-type: application/json' \
  --data "$(cat <<JSON
{
  "grant_type": "password",
  "username": "${AUTH0_TEST_USERNAME}",
  "password": "${AUTH0_TEST_PASSWORD}",
  "audience": "${AUTH0_AUDIENCE}",
  "client_id": "${AUTH0_CLIENT_ID}",
  "client_secret": "${AUTH0_CLIENT_SECRET}",
  "scope": "openid profile"
}
JSON
)")

ID_TOKEN=$(echo "${RESPONSE}" | jq -r '.id_token // empty')

if [ -z "${ID_TOKEN}" ]; then
  echo "Failed to get Auth0 token:" >&2
  echo "${RESPONSE}" >&2
  exit 1
fi

echo "${ID_TOKEN}"
