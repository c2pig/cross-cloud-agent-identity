# Auth0 — Gemini Agent POC application

Clients and the API for this POC. Design owner: this repository. The tenant contract is **not** here.

| Output needed from managed-infrastructure `stacks/global/auth0/platform` | Variable |
|---|---|
| `auth0_domain` | `auth0_domain` |
| `default_api_audience` | `auth0_audience` |

Platform state is local, so this stack takes those values as variables instead of `terraform_remote_state`.

## Owns

- SPA **Gemini Agent POC** (`PQR8JYTZrZJIIhi7HVdziEk4ipvTxIw1`)
- API **Gemini Agent POC API** (`https://gemini-agent-poc/api`), RS256, scope `preference:write`, 60s token
- Client grant so that SPA may request the API

## Does not own

Tenant settings, users, the Default App, the ROPG spike client, or the unused Frontdoor OBO Auth0 client. Do not import these objects into `managed-infrastructure`.

## Auth

M2M application **Gemini Agent POC Terraform**. Pass `terraform_client_id` and `terraform_client_secret` via environment or a gitignored `terraform.tfvars`. The secret never goes in Git.

```bash
cp terraform.tfvars.example terraform.tfvars
terraform init
terraform plan
```

Import blocks adopt the live SPA, API, and scopes on the first apply. If the client grant already exists, import `auth0_client_grant.spa` with its `cgr_` id before applying again.
