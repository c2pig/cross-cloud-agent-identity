# GCP runtime

Cloud Run services that are actually in the request path: MCP server, agent bridge, frontdoor, and frontend.

`auth0_domain` and `auth0_audience` are the managed-infrastructure platform outputs. The SPA client ID is baked into the frontend image by `scripts/deploy.sh` from `infra/auth0` output `spa_client_id`. This stack does not create Auth0 objects.

Service account emails and secret IDs match `infra/gcp-foundation`. Apply that stack first.

The retired Node service `gemini-poc-agent-service` is not in this stack. Frontdoor `AGENT_SERVICE_URL` points at `gemini-poc-agent-bridge`.

```bash
terraform init
terraform plan \
  -var=project_id="$GCP_PROJECT_ID" \
  -var=auth0_domain="$AUTH0_DOMAIN" \
  -var=auth0_audience="$AUTH0_AUDIENCE" \
  -var=reasoning_engine_id="$REASONING_ENGINE_ID" \
  -var=image_tag="$IMAGE_TAG"
```
