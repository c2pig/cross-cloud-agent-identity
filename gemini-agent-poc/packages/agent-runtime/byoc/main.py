"""BYOC entrypoint for Agent Runtime.

Implements the documented Agent Runtime custom-container runtime contract:
  POST /api/reasoning_engine         -- unary: {class_method, input} -> {"output": ...}
  POST /api/stream_reasoning_engine  -- streaming: {class_method, input} -> ndjson {"output": ...} lines

We own this Dockerfile, so the Agent Gateway egress TLS inspection CA is
installed directly (see Dockerfile) -- the whole reason for BYOC over the
managed deployment path, which has no supported way to do this.
"""

import inspect
import json
import os

import vertexai
from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse, StreamingResponse

PROJECT_ID = os.environ.get("GCP_PROJECT_ID")
LOCATION = os.environ.get("GCP_LOCATION", "us-central1")

# AdkApp.set_up() calls resource_manager_utils.get_project_id() to resolve the
# project number -> project ID for its telemetry instrumentor. That RPC
# (google-cloud-resourcemanager) routes through the attached egress Agent
# Gateway like everything else this container calls, and consistently fails
# there (TLS trust / IPv6 routing, depending on the attempt) -- happens
# whether the deployment is managed or BYOC, since it's inside the official
# SDK, not our code. We already know the project ID, so short-circuit the
# lookup entirely rather than let it make a network call we can't fix.
from google.cloud.aiplatform.utils import resource_manager_utils

resource_manager_utils.get_project_id = lambda project=None: PROJECT_ID

from vertexai.agent_engines import AdkApp
from real_estate_agent.agent import root_agent

vertexai.init(project=PROJECT_ID, location=LOCATION)
adk_app = AdkApp(agent=root_agent)

app = FastAPI()


async def _dispatch(class_method: str, method_input: dict):
    method = getattr(adk_app, class_method)
    if inspect.iscoroutinefunction(method) or inspect.isasyncgenfunction(method):
        return method(**(method_input or {}))
    return method(**(method_input or {}))


@app.post("/api/reasoning_engine")
async def reasoning_engine(request: Request):
    body = await request.json()
    class_method = body["class_method"]
    method_input = body.get("input") or {}
    result = await _dispatch(class_method, method_input)
    if inspect.isasyncgen(result):
        chunks = [chunk async for chunk in result]
        result = chunks
    elif inspect.isgenerator(result):
        result = list(result)
    return JSONResponse(content={"output": jsonable_encoder(result)})


@app.post("/api/stream_reasoning_engine")
async def stream_reasoning_engine(request: Request):
    body = await request.json()
    class_method = body["class_method"]
    method_input = body.get("input") or {}
    result = await _dispatch(class_method, method_input)

    async def _gen():
        if inspect.isasyncgen(result):
            async for chunk in result:
                yield json.dumps({"output": jsonable_encoder(chunk)}) + "\n"
        elif inspect.isgenerator(result):
            for chunk in result:
                yield json.dumps({"output": jsonable_encoder(chunk)}) + "\n"
        else:
            yield json.dumps({"output": jsonable_encoder(result)}) + "\n"

    return StreamingResponse(_gen(), media_type="application/x-ndjson")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 8080)))
