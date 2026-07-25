# ADR: Cross-Cloud Agent Identity, Trust, and Traceability (GCP Agent → AWS)

**Status:** Proposed
**Date:** 2026-07-25
**Scope:** Auth0-authenticated user → GCP agent → three AWS-side destinations (RDS/DynamoDB, AgentCore MCP, EKS company API)
**Excluded from this ADR:** the specific token-minting mechanism for the EKS/s2sAuth path — tracked as a separate decision.

---

## Context

A GCP agent acts on behalf of a human user authenticated via Auth0, and needs to call three distinct AWS-side destinations. Each destination has a different native trust mechanism. Governance requires that (a) the agent never holds the user's raw session token, and (b) every downstream action can be traced back to the initiating user, independent of which destination was called.

## Decision

**Front door (applies to all three destinations, decided once):**

| Component | Purpose |
|---|---|
| **Workforce Identity Federation** | Consumes the Auth0 ID token at the IAM edge; exchanges it for a Google identity. The Auth0 token is never forwarded to the agent runtime. |
| **Agent Identity Auth Manager** | Protects *connector-delegated* tool credentials (Drive, Salesforce, etc.), decrypted only at **Agent Gateway's egress mode**. **Not applicable** to any of the three destinations below — none are Gemini Enterprise connectors. |

**Agent Gateway — adopted, both modes:**

| Mode | Purpose | Applies to |
|---|---|---|
| **Client-to-Agent (ingress)** | Allow-lists which callers may invoke the agent (the Cloud Run front door's service account, specifically) instead of relying on IAM role possession alone. Provides an authorization-failure/RPS observability dashboard as a side effect. | The front-door → agent hop |
| **Agent-to-Anywhere (egress)** | Requires the destination (AWS AgentCore Gateway) to be a registered Agent Registry entry; enforces Agent Platform's default-deny egress posture; produces egress traffic logs (403 denials, unregistered-destination attempts). | The agent → AWS hop |

All three AWS destinations in this ADR are egress traffic from GCP's perspective, so egress-mode Agent Gateway sits as a policy gate *in front of* all three trust models below — enforcing that the destination is allowed at all — rather than replacing any of them. Ingress-mode Agent Gateway is a separate, independent decision governing only who may reach the agent in the first place.

**Trust model per destination (locked vocabulary):**

- **IAM Trust model** — STS `AssumeRoleWithWebIdentity` (Google federated as IAM OIDC provider) → SigV4-signed calls.
- **OAuth Trust model** — Bearer JWT validated against a JWKS/discovery URL, no AWS credentials involved.
- **mTLS Trust model** — Cryptographic identity at the transport layer (SPIFFE trust-domain federation). Evaluated, not selected for any destination below.

| Destination | Trust model selected | Traceability mechanism |
|---|---|---|
| RDS / DynamoDB | **IAM** (only option available) | STS session tags (`initiating_user`, `correlation_id`) → joined post-hoc against CloudTrail data events |
| AgentCore MCP | **IAM or OAuth**, gateway-configured, mutually exclusive per gateway | IAM mode: same as above. OAuth mode: `traceparent` propagates live over HTTP — preferred if configurable |
| EKS company API (s2sAuth) | **OAuth** (s2sAuth already implements this) | Custom JWT claims (`enduser_id`, `correlation_id`), verified against a **company-hosted** JWKS via Istio's authorizer |

## Consequences / Trade-offs

- **Audit strength is uneven by design, not oversight.** IAM Trust model calls (RDS/DynamoDB, and AgentCore MCP if run in IAM mode) cannot carry a live trace header — SigV4 has no slot for one — so those two paths rely on post-hoc log correlation via session tags, not distributed tracing.
- **AgentCore MCP has a real choice AWS data-plane services don't.** Choosing OAuth mode there trades a second trust mechanism to operate for a materially stronger, live-traced audit story.
- **s2sAuth's company-hosted JWKS rules out Google's own token issuance** (Google publishes JWKS on its own domains, not the company's), narrowing the EKS path to a signer whose public key can be published to the company's JWKS — the specific mechanism is the separate, excluded decision.
- **Correlation ID and initiating-user identity are treated as metadata, never as authorization** in every path — they ride alongside the credential (session tag, span attribute, custom claim) rather than being embedded in what grants access. This is deliberate: it keeps each hop's credential narrowly scoped and independently revocable, at the cost of requiring every hop to correctly propagate that metadata — a single dropped claim silently breaks the audit join.
- **This ADR's trust models describe what happens once a call is allowed to leave GCP — Agent Gateway (egress) is the layer that decides whether it's allowed to leave at all.** With it adopted, AWS AgentCore Gateway must be a registered Agent Registry entry and Agent Platform's default-deny egress posture applies; the trust models below then govern what happens once that gate has already passed. This is a genuinely separate control from all three trust models — it does not substitute for STS, JWT validation, or mTLS on the AWS side.
- **Agent Gateway ingress narrows the front-door → agent hop from "any `aiplatform.user` holder" to an explicit allow-listed caller**, and adds an authorization-failure/RPS dashboard that the direct-REST-call design didn't have.

## Open follow-up

- Token-minting mechanism for the EKS/s2sAuth path (candidates evaluated: Google OIDC, `signJwt()`, Cloud KMS, Auth0 Token Exchange) — separate ADR.
- Confirm whether s2sAuth's JWKS-hosting process has an existing onboarding path for a new consumer, or whether this requires a request to the platform team.
