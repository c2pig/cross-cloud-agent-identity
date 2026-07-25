# POC Plan: Auth0 → GCP Agent → AWS AgentCore → Dummy API

**Goal:** Prove the end-to-end identity and observability flow, not the agent's intelligence.
The agent's only job is to return `"hello world"`. Everything else — token issuance, front-door validation,
cross-cloud federation, and trace correlation — is what's actually being tested.

**Target test flow:**
```
[get Auth0 JWT] → [curl/gcloud with JWT] → [invoke GCP agent] → [AWS AgentCore] → [dummy API]
```

**Scope simplification vs. the production design we discussed:**
For POC speed, this plan uses **Google-minted ID tokens** (not Cloud KMS custom-claim signing) for the
GCP→AWS leg, and a **lightweight Cloud Run validator** (not full Workforce Identity Federation) as the
front door. Both are called out explicitly below so you know what's simplified and what maps 1:1 to the
real architecture.

---

## Phase 0 — Prerequisites

- Auth0 tenant (free tier is fine), with the ability to enable a grant type for scripted token retrieval
- GCP project with billing enabled; `gcloud` CLI authenticated; APIs enabled: `aiplatform.googleapis.com`,
  `run.googleapis.com`, `iamcredentials.googleapis.com`, `cloudtrace.googleapis.com`, `logging.googleapis.com`
- AWS account with Bedrock AgentCore available in your region; AWS CLI configured
- A terminal with `curl`, `jq`, and `gcloud` installed

---

## Phase 1 — Auth0: get a real user JWT via script

1. Create a **Machine to Machine** or **Regular Web App** in Auth0 (Applications → Create Application).
2. Enable **Password grant** (Resource Owner Password Grant) on this app under Advanced Settings → Grant Types
   — this is the standard way to script-obtain a real user's ID token without building a login UI. **POC-only —
   never enable this grant type in a production tenant.**
3. Create a test user (User Management → Users → Create User), note email/password.
4. Get the token:
   ```bash
   curl --request POST \
     --url https://YOUR_TENANT.auth0.com/oauth/token \
     --header 'content-type: application/json' \
     --data '{
       "grant_type": "password",
       "username": "testuser@example.com",
       "password": "TestPassword123!",
       "audience": "YOUR_API_IDENTIFIER",
       "client_id": "YOUR_CLIENT_ID",
       "client_secret": "YOUR_CLIENT_SECRET",
       "scope": "openid profile"
     }'
   ```
5. Save the returned `id_token` as `$AUTH0_JWT`. Decode it at jwt.io once to confirm `sub` is your test user.

**Checkpoint:** you can produce a fresh Auth0 JWT on demand from the command line.

---

## Phase 2 — GCP: front-door validator (Cloud Run)

This replaces full Workforce Identity Federation for POC purposes — same *purpose* (don't let the raw Auth0
token reach the agent), simpler to stand up.

1. Write a minimal Cloud Run service (Python/FastAPI or Node/Express) that:
   - Accepts `Authorization: Bearer <Auth0 JWT>`
   - Validates it against Auth0's JWKS (`https://YOUR_TENANT.auth0.com/.well-known/jwks.json`) — check
     signature, `iss`, `aud`, `exp`
   - Extracts `sub` → `enduser_id`
   - Generates a `correlation_id` (UUID) if none is passed in
   - Calls the GCP agent (Phase 3) using **its own service account identity** — the Auth0 token is consumed
     here and never forwarded
   - Passes `enduser_id` and `correlation_id` to the agent as request metadata
2. Deploy:
   ```bash
   gcloud run deploy agent-frontdoor \
     --source . \
     --service-account=frontdoor-sa@PROJECT.iam.gserviceaccount.com \
     --allow-unauthenticated \
     --set-env-vars=AUTH0_DOMAIN=YOUR_TENANT.auth0.com,AUTH0_AUDIENCE=YOUR_API_IDENTIFIER
   ```
   (`--allow-unauthenticated` is fine here — the *Auth0 JWT check inside the code* is your real gate for POC.)

**Checkpoint:** `curl -H "Authorization: Bearer $AUTH0_JWT" https://agent-frontdoor-xxx.run.app/chat` returns a
403 with a bad/expired token and passes through with a valid one.

---

## Phase 3 — GCP: the agent itself (hello world)

1. Build the simplest possible ADK agent — no tools, no reasoning, just:
   ```python
   def handle_request(request):
       return {"response": "hello world", "correlation_id": request.correlation_id}
   ```
2. Deploy to **Agent Engine** (Vertex AI / Gemini Enterprise Agent Platform):
   ```bash
   gcloud ai reasoning-engines create \
     --project=PROJECT_ID \
     --region=us-central1 \
     --display-name=poc-hello-agent \
     --package-uris=... \
     --python-module=agent.main
   ```
3. Instrument with OpenTelemetry: on receiving a request, start a span, attach `enduser.id` and the
   `correlation_id` as span attributes, before calling AWS in Phase 5.
4. Confirm the agent's principal shows up correctly:
   ```
   gcloud ai reasoning-engines describe RESOURCE_ID --region=us-central1
   ```
   Note the `principal://agents.global.org-.../reasoningEngines/poc-hello-agent` identifier — this is your
   Agent Identity, used in the next phase's trust policy.

**Checkpoint:** calling the reasoning engine directly (via `gcloud`, using your own Google identity token)
returns `hello world` and a Cloud Trace span appears in Cloud Trace with `enduser.id` set.

---

## Phase 4 — AWS: AgentCore Gateway + dummy target

1. Create a trivial Lambda that returns a fixed response:
   ```python
   def handler(event, context):
       return {"statusCode": 200, "body": '{"message": "hello world from AWS"}'}
   ```
2. Create an AgentCore Gateway with **Custom JWT (OAuth) inbound auth mode** (the mode we identified as
   preferring live trace propagation):
   ```bash
   aws bedrock-agentcore create-gateway \
     --name poc-gateway \
     --authorizer-configuration '{
       "customJWTAuthorizer": {
         "discoveryUrl": "https://accounts.google.com/.well-known/openid-configuration",
         "allowedAudiences": ["YOUR_GCP_PROJECT_ID_OR_CLIENT_ID"]
       }
     }'
   ```
   This trusts **Google-minted ID tokens** directly — simplest POC path, no KMS, no custom claims embedded
   in the signed token (those ride as separate headers instead, see Phase 5).
3. Attach the Lambda as a Gateway target.

**Checkpoint:** `aws bedrock-agentcore get-gateway --name poc-gateway` shows `ACTIVE`, target attached.

---

## Phase 5 — Wire the agent to call AgentCore

1. In the agent's outbound call (Phase 3, after the local "hello world" logic), have it:
   ```python
   id_token = fetch_id_token(audience="YOUR_GATEWAY_AUDIENCE")  # Google ADC call
   headers = {
       "Authorization": f"Bearer {id_token}",
       "traceparent": f"00-{correlation_id}-0000000000000001-01",
       "X-Enduser-Id": enduser_id
   }
   response = requests.post(GATEWAY_MCP_URL, headers=headers, json={"method": "tools/call", ...})
   ```
2. This is the **honest simplification point**: since Google's ID token can't carry custom claims,
   `enduser_id` rides as a plain header here rather than a signed claim. Note this explicitly as a known gap
   versus the production design (where KMS-signed custom claims would close it).

**Checkpoint:** the agent's response now includes both `"hello world"` (its own) and
`"hello world from AWS"` (via AgentCore) in one payload.

---

## Phase 6 — Observability wiring

| Signal | Where it should land |
|---|---|
| `enduser.id`, `correlation_id` on the GCP-side span | Cloud Trace + Cloud Logging (structured log field) |
| Same `correlation_id` on the AWS-side span | AgentCore Observability (OTel-native) and/or CloudWatch |
| Gateway invocation record | CloudTrail data event (enable data-event logging for `bedrock-agentcore`, off by default) |

Verification: after one end-to-end call, pull the `correlation_id` and confirm it appears in **both** Cloud
Trace and AgentCore Observability/CloudWatch for the same request — this is the actual thing the POC exists
to prove.

---

## Phase 7 — End-to-end test script

```bash
#!/bin/bash
set -e
AUTH0_JWT=$(curl -s --request POST --url https://YOUR_TENANT.auth0.com/oauth/token \
  --header 'content-type: application/json' \
  --data '{"grant_type":"password","username":"testuser@example.com","password":"TestPassword123!","audience":"YOUR_API_IDENTIFIER","client_id":"YOUR_CLIENT_ID","client_secret":"YOUR_CLIENT_SECRET","scope":"openid profile"}' \
  | jq -r .id_token)

echo "Got Auth0 JWT, calling front door..."
RESPONSE=$(curl -s -H "Authorization: Bearer $AUTH0_JWT" https://agent-frontdoor-xxx.run.app/chat)
echo "$RESPONSE" | jq .

CORR_ID=$(echo "$RESPONSE" | jq -r .correlation_id)
echo "Check Cloud Trace and AgentCore Observability for correlation_id=$CORR_ID"
```

---

## Validation checklist

- [ ] Auth0 JWT successfully rejected by front door when expired/tampered
- [ ] Auth0 JWT never appears in any GCP agent log or AWS-side log (search for it explicitly — it shouldn't be there)
- [ ] `enduser_id` and `correlation_id` present in both Cloud Trace and AgentCore Observability for the same call
- [ ] CloudTrail data event present for the Gateway invocation, taggable back to `correlation_id`
- [ ] Full round trip returns both hello-world payloads (GCP + AWS)

## Known gaps vs. production design (intentional, for POC speed)

- Front door is a hand-rolled Cloud Run validator, not Workforce Identity Federation
- GCP→AWS token is a plain Google ID token, not a KMS-signed custom-claim JWT — `enduser_id` rides as a header, not a verifiable claim
- Auth0 Password Grant used for scripting — not for any real login flow
