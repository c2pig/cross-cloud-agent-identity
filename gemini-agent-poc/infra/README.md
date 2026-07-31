# Infrastructure as Code (Terraform)

Provisions: Artifact Registry, three per-service accounts (least-privilege secret
access), Secret Manager secrets for the POC's signing keys, and four Cloud Run
services (mcp-server, agent-service, frontdoor, frontend).

This is illustrative IaC for a POC, not a hardened production module. It has
not been applied against a real GCP project as part of building this repo —
review it before running `terraform apply` against anything you care about.

## Two-phase apply (frontend build-time env problem)

The frontend is a Vite SPA: `VITE_FRONTDOOR_URL` gets baked into the static
bundle at **build time**, but the front door's Cloud Run URL only exists
*after* Terraform creates it. So bringing this up from scratch is two passes:

```bash
# Phase 1 — create everything except the frontend needs a real image first;
# build & push mcp-server / agent-service / frontdoor, then create them:
terraform apply \
  -var="project_id=$GCP_PROJECT_ID" \
  -var="auth0_domain=$AUTH0_DOMAIN" \
  -var="auth0_audience=$AUTH0_AUDIENCE" \
  -var="gemini_api_key=$GEMINI_API_KEY" \
  -var="image_tag=$IMAGE_TAG" \
  -target=google_cloud_run_v2_service.mcp_server \
  -target=google_cloud_run_v2_service.agent_service \
  -target=google_cloud_run_v2_service.frontdoor

FRONTDOOR_URL=$(terraform output -raw frontdoor_url)

# Phase 2 — now build the frontend image with that URL baked in, and apply
# everything (including the frontend service) in full:
gcloud builds submit ../packages/frontend \
  --tag "$(terraform output -raw artifact_registry_repo)/frontend:${IMAGE_TAG}" \
  --substitutions=_VITE_FRONTDOOR_URL="${FRONTDOOR_URL}"

terraform apply \
  -var="project_id=$GCP_PROJECT_ID" \
  -var="auth0_domain=$AUTH0_DOMAIN" \
  -var="auth0_audience=$AUTH0_AUDIENCE" \
  -var="gemini_api_key=$GEMINI_API_KEY" \
  -var="image_tag=$IMAGE_TAG"
```

`scripts/deploy.sh` at the repo root scripts exactly this sequence.

## What's deliberately not modeled in Terraform here

Vertex AI Agent Engine deployments, the Agent Registry, and Agent Gateway
(ingress/egress) resources either have no stable Terraform provider support
today, or are still moving targets in the underlying API. Rather than fake
resources that would silently drift from whatever the real console/CLI
surface looks like when you read this, those steps are left as documented
`gcloud` commands to run by hand once you're ready to move this POC's
agent-service off a plain Cloud Run container and onto real Agent Engine:

```bash
# Illustrative -- check current syntax before running; this surface moves.
gcloud ai reasoning-engines create \
  --project=$GCP_PROJECT_ID --region=$GCP_LOCATION \
  --display-name=real-estate-agent-v1 \
  --package-uris=... --python-module=agent.main

gcloud network-services agent-gateways import ... # or current console equivalent
```

See `docs/gcp-mapping.md` for how each piece of this POC maps to those real
primitives, and `docs/governance.md` for the operational controls (registry,
audit logging, secret scoping, rate limiting) this POC stands in for using
plain Node code instead of GCP-native services.

## Variables

| Variable | Purpose |
|---|---|
| `project_id` | GCP project to deploy into |
| `region` | Cloud Run / Artifact Registry region |
| `image_tag` | Tag applied to all four images (e.g. a git SHA) |
| `auth0_domain` / `auth0_audience` | Passed straight through to frontdoor's JWT validation |
| `gemini_api_key` | Optional; omit to run agent-service in mock-planner mode |
| `allow_unauthenticated_frontdoor` | Default `true` — the Auth0 check inside the app is the real gate |
| `enforce_cloud_run_iam_invoker` | Default `false` — see the warning in `variables.tf` before flipping this on |
