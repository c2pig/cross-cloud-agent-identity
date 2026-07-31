# Mapping this POC to the real Google Gemini Agent Platform

This POC simulates the concepts below in plain Node so they can be run and
inspected with zero cloud credentials. This doc is the "translation table"
back to the real GCP primitives, organized around the four things you said
you want to understand.

## 1. How Google agent identity works

| In this POC | In real GCP |
|---|---|
| `agent-service` mints its own signed token (`AGENT_IDENTITY_SIGNING_SECRET`, `sub: "agents/real-estate-agent-v1"`) on every call to `mcp-server` | A Vertex AI Agent Engine deployment gets an **automatic Google-managed identity** — `principal://iam.googleapis.com/.../reasoningEngines/{id}` — and can call `google.auth.transport.requests` + `google.oauth2.id_token.fetch_id_token()` (via the metadata server) to get a real, short-lived Google-signed ID token with no key management on your part |
| A shared HS256 secret, known to both `agent-service` and `mcp-server` | Google's own public JWKS — the verifier checks a Google-signed token against Google's published keys, not a secret you distribute yourself |
| One static agent identity for the whole POC | Each Agent Engine deployment gets its own distinct principal; multiple agents are distinguishable and independently revocable |

The key idea this POC preserves: **the agent has a real identity of its
own, separate from any user it's acting for.** That identity is what's
allowed to do read-only lookups on its own authority.

## 2. How the user-delegation (OBO) flow integrates with the UI

| In this POC | In real GCP |
|---|---|
| `agent-service` returns `{ type: "consent_required", ... }` instead of calling the write tool | The same shape of decision point — an agent that wants to take a consequential, user-scoped action pauses and asks, rather than silently acting |
| Frontend renders a modal (`ConsentModal.jsx`) with Approve/Deny before anything is persisted | Gemini Enterprise's connector-authorization UX for tool calls that touch user data follows the same "ask before persisting" shape, via the **Agent Identity Auth Manager** for connector-delegated credentials |
| `frontdoor` mints a 60-second, single-use JWT (`sub`=user, `act.sub`=agent, `scope`) only after approval | Real delegation here would use a downscoped / token-exchange credential (RFC 8693-style: an `act` "actor" claim distinguishing the user who delegated from the agent doing the acting) minted by a trust broker, not a shared secret |
| Denial mints no token at all | Same principle in production: a denied consent must produce zero delegated capability, not a token that's merely unused |

The important lesson this flow is meant to teach: **the UI consent moment
and the credential-minting moment are the same event.** There is no path in
this code where a write happens without a token that only exists because
the user just clicked "Approve."

## 3. How Google agent integration with Auth0 works

| In this POC | In real GCP |
|---|---|
| `frontdoor` validates the Auth0 access token against Auth0's JWKS directly (`packages/frontdoor/src/auth0.js`) and stops the token there — it's never forwarded to `agent-service` or `mcp-server` | **Workforce Identity Federation** is the production analog: it consumes the external IdP (Auth0) token at the IAM edge and exchanges it for a Google identity, so the Auth0 token still never reaches the agent runtime |
| The user's Auth0 `sub` is passed onward as a plain field (`userId`) | In production this would ride as an attribute on the exchanged Google identity, not a bare string trusted at face value by downstream services |
| Auth0 is the sole source of truth for "who is this user" | Same in production — Auth0 (or whatever your IdP is) stays authoritative; GCP's federation layer trusts it, it doesn't replace it |

This is the piece most worth remembering: **Auth0 doesn't get replaced by
GCP identity — it gets federated into it.** The front door is the one
component that ever sees both worlds.

## 4. How to govern the agent (registry, MCP endpoint, operations)

| In this POC | In real GCP |
|---|---|
| `packages/mcp-server/registry/agents.json`: an explicit allow-list of agent IDs, and which tools/scopes each may use — default deny for anything not listed | **Agent Registry**: Agent Engine deployments and MCP endpoints must be registered entries before an Agent Gateway will route to them at all |
| `mcp-server` checks the registry *before* even validating the OBO token | **Agent Gateway (egress mode)** enforces default-deny at the platform layer, as a gate in front of, not instead of, the destination's own trust model (IAM/OAuth/mTLS) — see the ADR in `poc/docs/adr-cross-cloud-agent-identity.md` in this repo's other POC for the fuller version of this argument |
| `agent-service` only accepts calls carrying `X-Frontdoor-Key` | **Agent Gateway (ingress mode)** allow-lists which caller identity may invoke the agent at all, rather than relying on possession of a role like `aiplatform.user` |
| `packages/mcp-server/src/audit.js`: in-memory log of every tool call, decision, and (when applicable) which user was being acted for | **Cloud Trace / Cloud Logging** plus the Agent Gateway **Observability tab** (authorization attempts/failures, RPS) give you this for real, and it's what you'd actually alert on |
| Per-service Google Cloud service accounts with least-privilege Secret Manager access (`infra/secrets.tf`) | Same IAM principle, just for real: narrowly scoped, independently revocable credentials per hop |

### Other governance angles worth adding as you move past this POC

- **Consent audit trail**: this POC logs approve/deny decisions but doesn't
  persist them past process restart — a real deployment should durably log
  every consent decision, not just the resulting tool call.
- **Scope granularity**: `preference:write` is one coarse scope here; a real
  system would likely separate scopes per preference field or per
  action severity.
- **Token replay window**: the OBO token's 60-second expiry plus
  single-use `consent_id` tracking is deliberately tight — worth stress
  testing what happens under clock skew or retries before trusting it.
- **Rate limiting / abuse controls**: not implemented here at all; a real
  MCP endpoint governing agent traffic would want per-agent rate limits,
  independent of the registry allow-list.
- **Key rotation**: the POC's shared HS256 secrets have no rotation story;
  real Google-issued tokens rotate automatically by virtue of being
  short-lived and platform-managed.
- **Cloud Run IAM invoker enforcement**: see the `enforce_cloud_run_iam_invoker`
  variable in `infra/variables.tf` — turned off by default because it
  requires moving the app's custom tokens off the `Authorization` header
  first (see that variable's description for the exact collision).
