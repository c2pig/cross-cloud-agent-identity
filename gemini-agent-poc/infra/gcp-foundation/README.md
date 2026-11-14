# GCP foundation

Project APIs, Artifact Registry, per-hop service accounts, and Secret Manager secrets for the Gemini agent POC.

Auth0 domain and audience are not defined here. They come from managed-infrastructure `stacks/global/auth0/platform` and are passed into `infra/gcp-runtime`.

## Owns

- APIs used by the live project, including Network Services and Agent Registry
- Docker repository `gemini-agent-poc`
- Service accounts `gemini-poc-frontdoor`, `gemini-poc-agent`, `gemini-poc-mcp-server`
- Secrets `gemini-poc-obo-signing-secret`, `gemini-poc-agent-identity-signing-secret`, `gemini-poc-frontdoor-to-agent-key`

The Gemini API key secret is not managed. The live agent uses Vertex AI, not a pasted API key.

## Commands

```bash
terraform init
terraform plan -var=project_id="$GCP_PROJECT_ID"
```

State is local and gitignored. Secret values exist only in that state and in Secret Manager.
