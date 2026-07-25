# Build Spec: Auth0 → Cloud Run Front Door → GCP Agent → AWS AgentCore → Dummy API

**Audience:** this doc is written to be handed directly to an implementation agent (Claude Code).
**Goal:** working, testable POC — not production hardening. The agent's only job is to say "hello world."
**Do not deviate from the architecture below without flagging the deviation back to the requester.**

---

## 1. Architecture (target state)

```
[curl] --Auth0 JWT--> [Cloud Run front door] --Google SA identity-->
                                                                     [GCP Agent Gateway, Client-to-Agent / ingress mode]
                                                                            | allow-lists front door SA only
                                                                            v
                                                                     [GCP Agent Engine]
                                                                            |
                                                                    fetch_id_token(aud=Gateway)
                                                                            v
                                                                     [GCP Agent Gateway, Agent-to-Anywhere / egress mode]
                                                                            | destination must be a registered Agent Registry entry
                                                                            v
                                                              [AWS AgentCore Gateway, JWT/OAuth mode]
                                                                            |
                                                                            v
                                                                    [AWS Lambda: "hello world from AWS"]

Observability: Cloud Trace + Cloud Logging + Agent Gateway dashboards (GCP side)
                <--correlation_id--> AgentCore Observability + CloudWatch (AWS side)
```

## 2. Repository layout to create

```
poc/
├── .env.example
├── README.md
├── frontdoor/
│   ├── main.py
│   ├── requirements.txt
│   └── Dockerfile
├── agent/
│   ├── agent.py
│   ├── requirements.txt
│   └── deploy.py
├── aws/
│   ├── lambda/
│   │   └── handler.py
│   └── gateway/
│       └── create_gateway.sh
├── scripts/
│   ├── get_auth0_token.sh
│   └── e2e_test.sh
└── docs/
    └── (existing ADR and POC plan, copied in for reference)
```

## 3. Component specs

### 3.1 `frontdoor/main.py` (Cloud Run, Python/FastAPI)

Responsibilities:
- Expose `POST /chat`, accepting `Authorization: Bearer <Auth0 JWT>` and a JSON body `{"message": "..."}`.
- Validate the JWT against Auth0's JWKS (`https://${AUTH0_DOMAIN}/.well-known/jwks.json`): signature, `iss`, `aud` (`AUTH0_AUDIENCE`), `exp`. Reject with 401 on failure.
- On success: extract `sub` as `enduser_id`. Generate a `correlation_id` (UUID4) if the client didn't supply one via `X-Correlation-Id`.
- Call the GCP agent (Vertex AI REST endpoint, `:query`) using the Cloud Run service's own identity (ADC — no manual token handling needed; use `google.auth.transport.requests` + `google.oauth2.id_token` or the `google-cloud-aiplatform` SDK). **The Auth0 JWT must not be forwarded past this point.**
- Pass `enduser_id` and `correlation_id` to the agent as part of the request body (`config.configurable`).
- Return the agent's response plus `correlation_id` to the caller, for the test script to pick up.
- Structured logging: log `enduser_id`, `correlation_id`, and outcome (success/failure) on every request — this is a required observability signal, not optional.

Dependencies: `fastapi`, `uvicorn`, `pyjwt`, `cryptography`, `google-cloud-aiplatform`, `google-auth`.

Config via env vars: `AUTH0_DOMAIN`, `AUTH0_AUDIENCE`, `GCP_PROJECT_ID`, `GCP_LOCATION`, `REASONING_ENGINE_ID`.

### 3.2 `agent/agent.py` (ADK agent, deployed to Agent Engine)

Responsibilities:
- Accept the incoming request (message + `enduser_id` + `correlation_id`).
- Start/continue an OpenTelemetry span; set span attributes `enduser.id` and a custom `correlation_id` attribute.
- Build local response: `{"message": "hello world"}`.
- Call AWS AgentCore Gateway:
  - `google.auth.transport.requests` + `google.oauth2.id_token.fetch_id_token(request, audience=GATEWAY_AUDIENCE)` to get a Google ID token.
  - `POST` to `GATEWAY_MCP_URL` with headers: `Authorization: Bearer <id_token>`, `traceparent: 00-<correlation_id padded to 32 hex>-0000000000000001-01`, `X-Enduser-Id: <enduser_id>`.
  - Body: MCP JSON-RPC `tools/call` request invoking the dummy Lambda target.
- Combine both responses: `{"gcp_response": "hello world", "aws_response": "<lambda response>", "correlation_id": "..."}`.
- Export the span (Cloud Trace exporter, standard OTel GCP exporter package).

Dependencies: `google-adk` (or equivalent ADK package), `google-auth`, `opentelemetry-sdk`, `opentelemetry-exporter-gcp-trace`, `requests`.

Config via env vars: `GATEWAY_MCP_URL`, `GATEWAY_AUDIENCE`.

### 3.3 `agent/deploy.py`

Script that packages and deploys `agent.py` to Vertex AI Agent Engine (`reasoning_engines.ReasoningEngine.create(...)`), printing the resulting `reasoningEngines/{ID}` resource path to stdout for use in `.env`.

### 3.4 `aws/lambda/handler.py`

```python
import json
def handler(event, context):
    return {"statusCode": 200, "body": json.dumps({"message": "hello world from AWS"})}
```

### 3.5 `aws/gateway/create_gateway.sh`

Shell script using AWS CLI to:
1. Package and deploy the Lambda (`aws lambda create-function` or update if exists).
2. Create an AgentCore Gateway with **Custom JWT (OAuth) inbound auth**, `discoveryUrl=https://accounts.google.com/.well-known/openid-configuration`, `allowedAudiences=[GATEWAY_AUDIENCE]`.
3. Attach the Lambda as a Gateway target.
4. Print the Gateway's invocation URL for use in `.env`.
5. **Explicitly enable CloudTrail data-event logging** for `bedrock-agentcore` — not on by default, required for the audit checkpoint later.

### 3.6 `scripts/get_auth0_token.sh`

Wraps the Auth0 password-grant `curl` call (per earlier plan), outputs the JWT to stdout, so `e2e_test.sh` can capture it.

### 3.7 `scripts/e2e_test.sh`

1. Call `get_auth0_token.sh`, capture JWT.
2. `curl` the Cloud Run front door with the JWT.
3. Print the response, extract `correlation_id`.
4. Print two follow-up commands (not auto-executed) for manually checking Cloud Trace and CloudWatch/AgentCore Observability for that `correlation_id`.
5. **Negative case A (front-door auth):** re-run step 2 with a tampered/expired JWT; assert HTTP 401.
6. **Negative case B (ingress gateway):** call the Agent Engine `:query` endpoint directly (bypassing the front door), using a caller identity that is *not* the front door's service account; assert denial at Agent Gateway ingress, and print the log location to confirm it was recorded.
7. **Negative case C (egress gateway):** temporarily point the agent's outbound call at an endpoint that is *not* registered in Agent Registry; assert denial at Agent Gateway egress, and print the log location to confirm it was recorded. Revert after the check.

### 3.8 Agent Gateway setup (ingress + egress)

Responsibilities, done once before Phase 3.3/3.2 traffic can flow through it:

1. **Register resources in Agent Registry** — the Agent Engine deployment (once its `REASONING_ENGINE_ID` exists) and the AWS AgentCore Gateway endpoint must both be added as registered entries before either gateway will route to them.
2. **Create the ingress gateway** (`gcloud network-services agent-gateways import ...` or console equivalent), bound to the Cloud Run front door's service account as the only allowed caller. All Agent Runtime agents in this project+region must bind to this same ingress gateway — there is no per-agent override.
3. **Create the egress gateway**, with an authorization policy that explicitly allow-lists the AWS AgentCore Gateway MCP endpoint as a permitted destination. Default-deny applies to everything not explicitly listed.
4. Grant the Discovery Engine Service Agent the permissions it needs to discover resources and route traffic (custom role — see GCP docs for the exact permission set, this changes with product updates).
5. Confirm via the Agent Gateway **Observability tab** (scorecards: authorization attempts, authorization failures, requests/sec) that both gateways show traffic once Phase 7's test script runs.

**This is the step most likely to have API/CLI surface drift between when this spec was written and when it's implemented** — if `gcloud network-services agent-gateways` doesn't match current syntax, check `gcloud alpha` or `gcloud beta` prefixes and the current Gemini Enterprise Agent Platform docs before assuming the command is wrong.

## 4. IAM / permissions checklist

| Identity | Needs |
|---|---|
| Cloud Run front door's service account | `roles/aiplatform.user` (to call the Agent Engine `:query` endpoint) |
| Agent Engine's runtime service account | Default compute SA is fine for POC; must be able to call `fetch_id_token` via ADC (no extra role needed for metadata-server-based ID tokens) |
| AWS Lambda execution role | Basic execution role (CloudWatch Logs write) only — no other AWS resources touched |
| AgentCore Gateway service role | Permission to invoke the attached Lambda target |
| GCP Agent Gateway (ingress) | Authorization policy allow-listing the Cloud Run front door's service account as the only permitted caller |
| GCP Agent Gateway (egress) | Authorization policy allow-listing the AWS AgentCore Gateway MCP endpoint as the only permitted egress destination |
| Discovery Engine Service Agent | Custom role granting resource-discovery and traffic-routing permissions (exact permission set: check current docs at build time) |

## 5. Environment variables (`.env.example`)

```
AUTH0_DOMAIN=your-tenant.auth0.com
AUTH0_AUDIENCE=your-api-identifier
AUTH0_CLIENT_ID=...
AUTH0_CLIENT_SECRET=...
AUTH0_TEST_USERNAME=testuser@example.com
AUTH0_TEST_PASSWORD=...

GCP_PROJECT_ID=...
GCP_LOCATION=us-central1
REASONING_ENGINE_ID=...      # filled in after agent/deploy.py runs
FRONTDOOR_URL=...            # filled in after Cloud Run deploy

GATEWAY_AUDIENCE=...         # matches allowedAudiences in create_gateway.sh
GATEWAY_MCP_URL=...          # filled in after create_gateway.sh runs
```

## 6. Build order (do not parallelize — later steps depend on earlier output)

1. AWS: run `create_gateway.sh` → capture `GATEWAY_MCP_URL`, confirm CloudTrail data events enabled.
2. GCP: implement and deploy `agent/agent.py` via `deploy.py` → capture `REASONING_ENGINE_ID`.
3. GCP: implement `frontdoor/main.py`, deploy to Cloud Run → capture `FRONTDOOR_URL`.
4. GCP: set up Agent Gateway ingress and egress per section 3.8, registering both the Agent Engine deployment and the AWS AgentCore Gateway endpoint in Agent Registry.
5. Wire `.env` with all captured values.
6. Run `scripts/e2e_test.sh`.

## 7. Acceptance criteria

- [ ] `e2e_test.sh` returns a JSON response containing both `"hello world"` and `"hello world from AWS"`.
- [ ] The same `correlation_id` is discoverable in both Cloud Trace/Logging and CloudWatch/AgentCore Observability for one test run.
- [ ] A deliberately expired or tampered Auth0 JWT is rejected by the front door with HTTP 401, before anything reaches the agent.
- [ ] Searching all GCP and AWS logs for the literal Auth0 JWT string returns no matches beyond the front door's own validation step.
- [ ] CloudTrail shows a data event for the Gateway invocation.
- [ ] A call to the agent from any identity other than the Cloud Run front door's service account is denied at the Agent Gateway ingress layer.
- [ ] The Agent Gateway egress observability dashboard shows the successful call to AWS AgentCore Gateway; a deliberate attempt to call an unregistered destination is denied and logged.

## 8. Explicitly out of scope for this POC (do not build)

- Cloud KMS custom-claim signing for the GCP→AWS leg (Google ID token is sufficient here)
- Workforce Identity Federation (Cloud Run front door substitutes for it)
- Any production-grade secret management beyond `.env` / Secret Manager basics
- Auth0 Password Grant is POC-only — do not carry this grant type into any other environment
