#!/usr/bin/env bash
#
# Applies the Gemini POC stacks and builds the Cloud Run images.
# Auth0 domain and audience come from managed-infrastructure
# stacks/global/auth0/platform. This script does not create a tenant.
#
# Order: auth0 (when the M2M secret is set), foundation, agent, runtime.
# The agent stack is applied before Cloud Run so the bridge's Vertex role
# exists. It does not create the reasoning engine; see infra/gcp-agent/README.md.
#
# Requires: gcloud, terraform, and gemini-agent-poc/.env (see .env.example).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
INFRA_DIR="${ROOT_DIR}/infra"

if [ -f "${ROOT_DIR}/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "${ROOT_DIR}/.env"
  set +a
fi

: "${GCP_PROJECT_ID:?set GCP_PROJECT_ID}"
: "${GCP_LOCATION:=us-central1}"
: "${AUTH0_DOMAIN:?set AUTH0_DOMAIN}"
: "${AUTH0_AUDIENCE:?set AUTH0_AUDIENCE}"
: "${REASONING_ENGINE_ID:?set REASONING_ENGINE_ID}"
IMAGE_TAG="${IMAGE_TAG:-$(git -C "${ROOT_DIR}" rev-parse --short HEAD 2>/dev/null || date +%s)}"

apply_stack() {
  local stack="$1"
  shift
  echo "==> terraform apply ${stack}"
  terraform -chdir="${INFRA_DIR}/${stack}" init -input=false
  terraform -chdir="${INFRA_DIR}/${stack}" apply -input=false -auto-approve "$@"
}

# AUTH0_CLIENT_ID is the SPA (VITE_AUTH0_CLIENT_ID). The Management API M2M
# is a different client: AUTH0_TERRAFORM_CLIENT_ID / AUTH0_TERRAFORM_CLIENT_SECRET.
if [ -n "${AUTH0_TERRAFORM_CLIENT_SECRET:-}" ] && [ -n "${AUTH0_TERRAFORM_CLIENT_ID:-}" ]; then
  apply_stack auth0 \
    -var="auth0_domain=${AUTH0_DOMAIN}" \
    -var="auth0_audience=${AUTH0_AUDIENCE}" \
    -var="terraform_client_id=${AUTH0_TERRAFORM_CLIENT_ID}" \
    -var="terraform_client_secret=${AUTH0_TERRAFORM_CLIENT_SECRET}"
  AUTH0_CLIENT_ID="$(terraform -chdir="${INFRA_DIR}/auth0" output -raw spa_client_id)"
else
  echo "==> Skipping infra/auth0 (set AUTH0_TERRAFORM_CLIENT_ID and AUTH0_TERRAFORM_CLIENT_SECRET to adopt the SPA and API)."
  : "${AUTH0_CLIENT_ID:?set AUTH0_CLIENT_ID to the SPA client id}"
fi

apply_stack gcp-foundation \
  -var="project_id=${GCP_PROJECT_ID}" \
  -var="region=${GCP_LOCATION}"

apply_stack gcp-agent \
  -var="project_id=${GCP_PROJECT_ID}" \
  -var="region=${GCP_LOCATION}"

REPO="${GCP_LOCATION}-docker.pkg.dev/${GCP_PROJECT_ID}/gemini-agent-poc"

echo "==> Building mcp-server, agent-bridge, frontdoor"
gcloud builds submit "${ROOT_DIR}/packages/mcp-server" --tag "${REPO}/mcp-server:${IMAGE_TAG}"
gcloud builds submit "${ROOT_DIR}/packages/agent-runtime" --tag "${REPO}/agent-bridge:${IMAGE_TAG}"
gcloud builds submit "${ROOT_DIR}/packages/frontdoor" --tag "${REPO}/frontdoor:${IMAGE_TAG}"

RUNTIME_VARS=(
  -var="project_id=${GCP_PROJECT_ID}"
  -var="region=${GCP_LOCATION}"
  -var="image_tag=${IMAGE_TAG}"
  -var="auth0_domain=${AUTH0_DOMAIN}"
  -var="auth0_audience=${AUTH0_AUDIENCE}"
  -var="reasoning_engine_id=${REASONING_ENGINE_ID}"
)

echo "==> Phase 1: mcp-server, bridge, frontdoor"
terraform -chdir="${INFRA_DIR}/gcp-runtime" init -input=false
terraform -chdir="${INFRA_DIR}/gcp-runtime" apply -input=false -auto-approve \
  "${RUNTIME_VARS[@]}" \
  -target=google_cloud_run_v2_service.mcp_server \
  -target=google_cloud_run_v2_service.bridge \
  -target=google_cloud_run_v2_service.frontdoor

FRONTDOOR_URL="$(terraform -chdir="${INFRA_DIR}/gcp-runtime" output -raw frontdoor_url)"
echo "Front door deployed at: ${FRONTDOOR_URL}"

echo "==> Building frontend image with VITE_FRONTDOOR_URL=${FRONTDOOR_URL}"
gcloud builds submit "${ROOT_DIR}/packages/frontend" \
  --tag "${REPO}/frontend:${IMAGE_TAG}" \
  --config /dev/stdin <<EOF
steps:
  - name: gcr.io/cloud-builders/docker
    args:
      - build
      - --build-arg=VITE_AUTH0_DOMAIN=${AUTH0_DOMAIN}
      - --build-arg=VITE_AUTH0_CLIENT_ID=${AUTH0_CLIENT_ID}
      - --build-arg=VITE_AUTH0_AUDIENCE=${AUTH0_AUDIENCE}
      - --build-arg=VITE_FRONTDOOR_URL=${FRONTDOOR_URL}
      - --build-arg=VITE_ALLOW_MOCK_AUTH=false
      - -t
      - ${REPO}/frontend:${IMAGE_TAG}
      - .
images:
  - ${REPO}/frontend:${IMAGE_TAG}
EOF

echo "==> Phase 2: frontend"
terraform -chdir="${INFRA_DIR}/gcp-runtime" apply -input=false -auto-approve "${RUNTIME_VARS[@]}"

MCP_SERVER_URL="$(terraform -chdir="${INFRA_DIR}/gcp-runtime" output -raw mcp_server_url)"
terraform -chdir="${INFRA_DIR}/gcp-agent" apply -input=false -auto-approve \
  -var="project_id=${GCP_PROJECT_ID}" \
  -var="region=${GCP_LOCATION}" \
  -var="mcp_server_url=${MCP_SERVER_URL}"

echo ""
echo "==> Done."
terraform -chdir="${INFRA_DIR}/gcp-runtime" output
echo "Reasoning engine is still created by: MCP_SERVER_URL=${MCP_SERVER_URL} python packages/agent-runtime/deploy.py"
