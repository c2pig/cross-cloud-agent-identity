"""
Cloud Run front door.

Validates an Auth0-issued JWT, then calls the GCP agent (Vertex AI Agent
Engine `:query` endpoint) using this service's own Google identity (ADC).
The Auth0 JWT is consumed here and never forwarded past this point.
"""
import json
import logging
import os
import time
import uuid

import jwt
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from google.auth.transport.requests import AuthorizedSession
from google.auth import default as google_auth_default
from jwt import PyJWKClient
from pydantic import BaseModel

AUTH0_DOMAIN = os.environ["AUTH0_DOMAIN"]
AUTH0_AUDIENCE = os.environ["AUTH0_AUDIENCE"]
GCP_PROJECT_ID = os.environ["GCP_PROJECT_ID"]
GCP_LOCATION = os.environ.get("GCP_LOCATION", "us-central1")
REASONING_ENGINE_ID = os.environ["REASONING_ENGINE_ID"]

JWKS_URL = f"https://{AUTH0_DOMAIN}/.well-known/jwks.json"
ISSUER = f"https://{AUTH0_DOMAIN}/"
QUERY_URL = (
    f"https://{GCP_LOCATION}-aiplatform.googleapis.com/v1/projects/"
    f"{GCP_PROJECT_ID}/locations/{GCP_LOCATION}/reasoningEngines/"
    f"{REASONING_ENGINE_ID}:query"
)

_jwk_client = PyJWKClient(JWKS_URL)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("frontdoor")

app = FastAPI()


class ChatRequest(BaseModel):
    message: str


def _log(event: str, **fields):
    """Structured log line. Never include the raw JWT in `fields`."""
    logger.info(json.dumps({"event": event, **fields}))


def _validate_auth0_jwt(authorization: str | None) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="missing bearer token")
    token = authorization[len("Bearer "):]
    try:
        signing_key = _jwk_client.get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            audience=AUTH0_AUDIENCE,
            issuer=ISSUER,
            options={"require": ["exp", "iss", "aud", "sub"]},
        )
    except jwt.PyJWTError as exc:
        _log("auth_reject", reason=str(exc))
        raise HTTPException(status_code=401, detail="invalid token") from exc
    return claims


def _call_agent(enduser_id: str, correlation_id: str, message: str) -> dict:
    credentials, _ = google_auth_default()
    session = AuthorizedSession(credentials)
    body = {
        "input": {
            "message": message,
        },
        "config": {
            "configurable": {
                "enduser_id": enduser_id,
                "correlation_id": correlation_id,
            }
        },
    }
    resp = session.post(QUERY_URL, json=body, timeout=30)
    resp.raise_for_status()
    return resp.json()


@app.post("/chat")
async def chat(
    body: ChatRequest,
    request: Request,
    authorization: str | None = Header(default=None),
    x_correlation_id: str | None = Header(default=None, alias="X-Correlation-Id"),
):
    start = time.monotonic()
    correlation_id = x_correlation_id or str(uuid.uuid4())

    claims = _validate_auth0_jwt(authorization)
    enduser_id = claims["sub"]

    try:
        agent_response = _call_agent(enduser_id, correlation_id, body.message)
    except Exception as exc:
        _log(
            "chat_failure",
            enduser_id=enduser_id,
            correlation_id=correlation_id,
            error=str(exc),
            duration_ms=int((time.monotonic() - start) * 1000),
        )
        raise HTTPException(status_code=502, detail="agent call failed") from exc

    _log(
        "chat_success",
        enduser_id=enduser_id,
        correlation_id=correlation_id,
        duration_ms=int((time.monotonic() - start) * 1000),
    )

    return JSONResponse(
        {
            "correlation_id": correlation_id,
            **agent_response,
        }
    )


@app.get("/healthz")
async def healthz():
    return {"status": "ok"}
