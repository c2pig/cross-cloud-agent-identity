"""Thin bridge between frontdoor (Node) and the real Vertex AI Agent Runtime.

Node has no mature client library for Agent Engine sessions/streamQuery, so
this small service uses the official `vertexai` Python SDK to do that work
for real, exposing the same request/response shape frontdoor already speaks
(the same contract the old hand-rolled agent-service used) so frontdoor's
own code changes are minimal.

This process is itself just another authorized *caller* of the real Agent
Runtime -- it goes through the real ingress Agent Gateway like any other
caller would. It never sees the user's Auth0 JWT (frontdoor stops that at
the front door); it only ever receives {userId, sessionId, message} and,
after consent, an opaque delegation token that it forwards into ADK session
state -- never into the model-visible message.
"""

import datetime
import os
import uuid

import vertexai
import vertexai.agent_engines as ae
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel

PROJECT_ID = os.environ["GCP_PROJECT_ID"]
LOCATION = os.environ.get("GCP_LOCATION", "us-central1")
REASONING_ENGINE_ID = os.environ["REASONING_ENGINE_ID"]
FRONTDOOR_TO_AGENT_KEY = os.environ["FRONTDOOR_TO_AGENT_KEY"]
PORT = int(os.environ.get("PORT", os.environ.get("AGENT_BRIDGE_PORT", 8081)))

RESOURCE_NAME = (
    f"projects/{PROJECT_ID}/locations/{LOCATION}/reasoningEngines/{REASONING_ENGINE_ID}"
)

client = vertexai.Client(
    project=PROJECT_ID, location=LOCATION, http_options=dict(api_version="v1beta1")
)
remote_agent = ae.get(RESOURCE_NAME)

app = FastAPI()


def check_key(x_frontdoor_key: str | None):
    if not x_frontdoor_key or x_frontdoor_key != FRONTDOOR_TO_AGENT_KEY:
        raise HTTPException(status_code=401, detail="invalid or missing X-Frontdoor-Key")


def ensure_session(user_id: str, session_id: str, correlation_id: str | None):
    session_name = f"{RESOURCE_NAME}/sessions/{session_id}"
    try:
        client.agent_engines.get_session(name=session_name)
        return
    except Exception:
        pass
    client.agent_engines.create_session(
        name=RESOURCE_NAME,
        user_id=user_id,
        config={
            "session_id": session_id,
            "session_state": {"user_id": user_id, "correlation_id": correlation_id},
        },
    )


def extract_turn(events) -> dict:
    """Walks ADK stream_query events for the final model text and any
    consent_required proposal from propose_update_preference."""
    final_text = None
    consent = None
    for event in events:
        content = event.get("content") or {}
        role = content.get("role")
        for part in content.get("parts", []):
            if role == "model" and "text" in part and part["text"]:
                final_text = part["text"]
            func_response = part.get("function_response")
            if func_response and func_response.get("name") == "propose_update_preference":
                response = func_response.get("response") or {}
                if response.get("status") == "consent_required":
                    consent = response
    return {"final_text": final_text, "consent": consent}


class ChatRequest(BaseModel):
    userId: str
    sessionId: str
    message: str
    correlationId: str | None = None


@app.get("/healthz")
async def healthz():
    return {"status": "ok", "resource": RESOURCE_NAME}


@app.post("/agent/chat")
async def chat(req: ChatRequest, x_frontdoor_key: str | None = Header(default=None)):
    check_key(x_frontdoor_key)
    ensure_session(req.userId, req.sessionId, req.correlationId)

    events = list(
        remote_agent.stream_query(message=req.message, user_id=req.userId, session_id=req.sessionId)
    )
    turn = extract_turn(events)

    if turn["consent"]:
        consent_id = str(uuid.uuid4())
        return {
            "type": "consent_required",
            "consentId": consent_id,
            "tool": "update_preference",
            "proposedPatch": turn["consent"].get("proposedPatch"),
            "message": turn["consent"].get("askText"),
        }

    return {"type": "final", "message": turn["final_text"] or ""}


class ConsentCallbackRequest(BaseModel):
    consentId: str
    approved: bool
    oboToken: str | None = None
    correlationId: str | None = None
    userId: str
    sessionId: str


@app.post("/agent/consent-callback")
async def consent_callback(
    req: ConsentCallbackRequest, x_frontdoor_key: str | None = Header(default=None)
):
    check_key(x_frontdoor_key)

    if not req.approved:
        return {"message": "Okay, I won't make that change."}

    session_name = f"{RESOURCE_NAME}/sessions/{req.sessionId}"
    # The delegation token lands only in session state -- never in a message
    # the model reads -- matching Agent Identity's documented custom
    # auth-provider pattern (see docs/gcp-mapping.md).
    client.agent_engines.append_session_event(
        name=session_name,
        author="frontdoor",
        invocation_id=str(uuid.uuid4()),
        timestamp=datetime.datetime.now(datetime.timezone.utc),
        config={"actions": {"state_delta": {"obo_token": req.oboToken}}},
    )

    events = list(
        remote_agent.stream_query(
            message="SYSTEM: the user approved the pending preference update. Call apply_update_preference now.",
            user_id=req.userId,
            session_id=req.sessionId,
        )
    )
    turn = extract_turn(events)
    return {"message": turn["final_text"] or "Done."}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=PORT)
