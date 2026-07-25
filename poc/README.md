# Cross-Cloud Agent Identity POC

Proves the end-to-end identity and observability flow: an Auth0-authenticated
user calls a GCP agent, which calls an AWS AgentCore-fronted Lambda, with a
`correlation_id` traceable across both clouds — without the user's Auth0 JWT
ever leaving the front door.

The agent's only job is to say `"hello world"`. Everything else — token
issuance, front-door validation, cross-cloud federation, and trace
correlation — is what this POC actually tests.

See `docs/build-spec.md`, `docs/poc-plan.md`, and
`docs/adr-cross-cloud-agent-identity.md` for the full design context this
POC implements.

## Architecture

```
[curl] --Auth0 JWT--> [Cloud Run front door] --Google SA identity-->
                                                                     [GCP Agent Gateway, ingress]
                                                                            | allow-lists front door SA only
                                                                            v
                                                                     [GCP Agent Engine ("hello world" agent)]
                                                                            |
                                                                    fetch_id_token(aud=Gateway)
                                                                            v
                                                                     [GCP Agent Gateway, egress]
                                                                            | destination must be registered in Agent Registry
                                                                            v
                                                              [AWS AgentCore Gateway, Custom JWT/OAuth mode]
                                                                            v
                                                                    [AWS Lambda: "hello world from AWS"]
```

## Repository layout

```
poc/
├── .env.example              # all required config, copy to .env and fill in
├── frontdoor/                # Cloud Run service: validates Auth0 JWT, calls the GCP agent
├── agent/                    # ADK agent deployed to Vertex AI Agent Engine
├── aws/
│   ├── lambda/handler.py     # dummy "hello world from AWS" Lambda
│   └── gateway/create_gateway.sh  # provisions the AgentCore Gateway + Lambda target
├── scripts/
│   ├── get_auth0_token.sh    # Auth0 password-grant token fetch (POC-only)
│   └── e2e_test.sh           # happy path + 3 negative-case checks
└── docs/                     # reference: build spec, POC plan, ADR
```

## Build order

Later steps depend on earlier output — do not parallelize.

1. **AWS:** `aws/gateway/create_gateway.sh` → capture `GATEWAY_MCP_URL`, confirm CloudTrail data events enabled.
2. **GCP agent:** `agent/deploy.py` → capture `REASONING_ENGINE_ID`.
3. **GCP front door:** deploy `frontdoor/` to Cloud Run → capture `FRONTDOOR_URL`.
4. **GCP Agent Gateway:** set up ingress + egress gateways (see `docs/build-spec.md` §3.8) and register both
   the Agent Engine deployment and the AWS AgentCore Gateway endpoint in Agent Registry.
5. Fill in `.env` with all captured values.
6. Run `scripts/e2e_test.sh`.

### 1. AWS: Lambda + AgentCore Gateway

```bash
export AWS_REGION=us-east-1
export LAMBDA_FUNCTION_NAME=poc-hello-world
export LAMBDA_EXECUTION_ROLE_ARN=arn:aws:iam::ACCOUNT_ID:role/poc-lambda-execution-role
export GATEWAY_NAME=poc-gateway
export GATEWAY_SERVICE_ROLE_ARN=arn:aws:iam::ACCOUNT_ID:role/poc-agentcore-gateway-role
export GATEWAY_AUDIENCE=your-gcp-project-id-or-client-id

./aws/gateway/create_gateway.sh
```

Capture the printed `GATEWAY_MCP_URL`.

### 2. GCP: deploy the agent

```bash
export GCP_PROJECT_ID=...
export GCP_LOCATION=us-central1
export GATEWAY_MCP_URL=...   # from step 1
export GATEWAY_AUDIENCE=...  # matches step 1

cd agent
pip install -r requirements.txt
python deploy.py
```

Capture the printed `REASONING_ENGINE_ID`.

### 3. GCP: deploy the front door

```bash
cd frontdoor
gcloud run deploy agent-frontdoor \
  --source . \
  --service-account=frontdoor-sa@${GCP_PROJECT_ID}.iam.gserviceaccount.com \
  --allow-unauthenticated \
  --set-env-vars=AUTH0_DOMAIN=...,AUTH0_AUDIENCE=...,GCP_PROJECT_ID=...,GCP_LOCATION=...,REASONING_ENGINE_ID=...
```

Capture the printed service URL as `FRONTDOOR_URL`.

`--allow-unauthenticated` is intentional for this POC — the Auth0 JWT check
inside `frontdoor/main.py` is the real gate.

### 4. GCP: Agent Gateway ingress + egress

Follow `docs/build-spec.md` §3.8. This is the step most likely to have
CLI/API surface drift; check `gcloud alpha`/`gcloud beta` prefixes and current
Gemini Enterprise Agent Platform docs if the exact command shown there
doesn't match what's available.

### 5. Wire `.env`

```bash
cp .env.example .env
# fill in every value captured above
```

### 6. Run the test

```bash
set -a; source .env; set +a
./scripts/e2e_test.sh
```

## What the test proves

- **Happy path:** one call returns both `"hello world"` (GCP) and `"hello world from AWS"` (AWS AgentCore →
  Lambda), tagged with a shared `correlation_id`.
- **Negative case A:** a tampered/expired Auth0 JWT is rejected by the front door with HTTP 401 — before
  anything reaches the agent.
- **Negative case B:** a direct call to the Agent Engine `:query` endpoint from an identity other than the
  front door's service account is denied at the Agent Gateway ingress layer.
- **Negative case C:** the agent's outbound call to a destination not registered in Agent Registry is denied
  at the Agent Gateway egress layer (checked manually — see the script's printed instructions).

Cross-check the same `correlation_id` in Cloud Trace/Logging (GCP) and CloudWatch/AgentCore Observability
(AWS) — this join, not the "hello world" string itself, is what the POC exists to prove.

## Known gaps vs. production design (intentional, for POC speed)

- Front door is a hand-rolled Cloud Run validator, not Workforce Identity Federation.
- The GCP→AWS token is a plain Google ID token, not a KMS-signed custom-claim JWT — `enduser_id` rides as a
  header (`X-Enduser-Id`), not a verifiable claim.
- Auth0 Resource Owner Password Grant is used purely for scripting a test JWT — never carry this grant type
  into any other environment.

## Out of scope

- Cloud KMS custom-claim signing for the GCP→AWS leg
- Workforce Identity Federation
- Production-grade secret management beyond `.env` / Secret Manager basics
