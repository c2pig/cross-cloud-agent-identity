#!/usr/bin/env bash
#
# Builds and deploys all four services to Cloud Run via Terraform, in the
# order required by the frontend's build-time env var dependency on
# frontdoor's URL (see infra/README.md).
#
# Requires: gcloud (authenticated, default project set or GCP_PROJECT_ID set),
# terraform, and root .env populated (see .env.example).
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
GEMINI_API_KEY="${GEMINI_API_KEY:-}"
IMAGE_TAG="${IMAGE_TAG:-$(git -C "${ROOT_DIR}" rev-parse --short HEAD 2>/dev/null || date +%s)}"

TF_VARS=(
  "-var=project_id=${GCP_PROJECT_ID}"
  "-var=region=${GCP_LOCATION}"
  "-var=auth0_domain=${AUTH0_DOMAIN}"
  "-var=auth0_audience=${AUTH0_AUDIENCE}"
  "-var=gemini_api_key=${GEMINI_API_KEY}"
  "-var=image_tag=${IMAGE_TAG}"
)

cd "${INFRA_DIR}"
terraform init -upgrade

echo "==> Phase 0: create Artifact Registry repo (needed before any image push)"
terraform apply "${TF_VARS[@]}" -target=google_artifact_registry_repository.images -auto-approve

REPO="${GCP_LOCATION}-docker.pkg.dev/${GCP_PROJECT_ID}/gemini-agent-poc"

echo "==> Building and pushing mcp-server, agent-service, frontdoor images"
gcloud builds submit "${ROOT_DIR}/packages/mcp-server" --tag "${REPO}/mcp-server:${IMAGE_TAG}"
gcloud builds submit "${ROOT_DIR}/packages/agent-service" --tag "${REPO}/agent-service:${IMAGE_TAG}"
gcloud builds submit "${ROOT_DIR}/packages/frontdoor" --tag "${REPO}/frontdoor:${IMAGE_TAG}"

echo "==> Phase 1: deploy mcp-server, agent-service, frontdoor"
terraform apply "${TF_VARS[@]}" \
  -target=google_cloud_run_v2_service.mcp_server \
  -target=google_cloud_run_v2_service.agent_service \
  -target=google_cloud_run_v2_service.frontdoor \
  -auto-approve

FRONTDOOR_URL=$(terraform output -raw frontdoor_url)
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
      - --build-arg=VITE_AUTH0_CLIENT_ID=${AUTH0_CLIENT_ID:-}
      - --build-arg=VITE_AUTH0_AUDIENCE=${AUTH0_AUDIENCE}
      - --build-arg=VITE_FRONTDOOR_URL=${FRONTDOOR_URL}
      - --build-arg=VITE_ALLOW_MOCK_AUTH=false
      - -t
      - ${REPO}/frontend:${IMAGE_TAG}
      - .
images:
  - ${REPO}/frontend:${IMAGE_TAG}
EOF

echo "==> Phase 2: full apply (creates/updates frontend service)"
terraform apply "${TF_VARS[@]}" -auto-approve

echo ""
echo "==> Done. Outputs:"
terraform output
