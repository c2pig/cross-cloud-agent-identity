# Operating and governing this POC

Practical, this-repo-specific companion to `docs/gcp-mapping.md` (which
explains what each piece stands in for). This one is about how to actually
inspect and operate what you've deployed.

## Inspecting the agent registry

```bash
curl http://localhost:8082/admin/registry | jq .
```

`packages/mcp-server/registry/agents.json` is the full allow-list. To add a
second agent (e.g. to test the default-deny path), add an entry with a new
`id`, then try calling `mcp-server` with a token minted for an `id` that
*isn't* in the file — every tool call should be rejected with "agent is not
registered to call this tool," regardless of whether the token's signature
is valid.

## Inspecting the audit log

```bash
curl http://localhost:8082/admin/audit-log | jq .
```

Every tool call — allowed or denied — is recorded with: `tool`, `agentId`,
`decision`, `reason` (on denial), and `onBehalfOf` (the delegating user's
`sub`, present only for calls that went through the consent flow). Because
`onBehalfOf` is only ever populated when a valid OBO token was presented,
this log doubles as proof that reads and delegated writes are
distinguishable after the fact, not just at request time.

In this POC the log is in-memory and these two endpoints are unauthenticated
— fine for local inspection, not something to expose as-is. In production
this maps to Cloud Logging / Cloud Trace with the Agent Gateway
Observability tab providing the aggregate view (authorization
attempts/failures, requests/sec) — see `docs/gcp-mapping.md` §4.

## Rotating the POC's signing secrets

`OBO_SIGNING_SECRET`, `AGENT_IDENTITY_SIGNING_SECRET`, and
`FRONTDOOR_TO_AGENT_KEY` are shared, static secrets for local dev (root
`.env`) and Terraform-generated random values for Cloud Run
(`infra/gcp-foundation/secrets.tf`). To rotate in the deployed environment:

```bash
terraform -chdir=infra/gcp-foundation apply -replace=random_password.obo_signing_secret \
  -var="project_id=$GCP_PROJECT_ID"
```

This creates a new Secret Manager version and Cloud Run picks it up on the
next revision; no code change needed. Note that any tokens signed with the
old secret become unverifiable immediately — for `OBO_SIGNING_SECRET`
specifically that's fine given the 60-second token lifetime, but plan
rotations of `AGENT_IDENTITY_SIGNING_SECRET` around a deploy, not mid-day.

## Checklist before calling this "governed"

- [ ] Registry allow-list reviewed for every agent that can reach `mcp-server`
- [ ] Audit log shipped somewhere durable (not in-memory) with retention
- [ ] `/admin/*` endpoints authenticated or removed entirely outside local dev
- [ ] Secrets rotated on a schedule, not just on suspicion of compromise
- [ ] Consent decisions (not just resulting tool calls) durably logged
- [ ] Rate limiting in front of `mcp-server`, independent of the registry check
- [ ] Decide on `enforce_cloud_run_iam_invoker` (see `infra/gcp-runtime`) and
      do the header-scheme rework it requires, if you want real GCP-level
      ingress enforcement rather than just the app-level checks this POC ships
