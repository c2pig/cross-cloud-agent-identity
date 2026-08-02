"""Minimal MCP (Model Context Protocol) JSON-RPC client over Streamable HTTP.

Calls the real mcp-server (packages/mcp-server) using the actual MCP wire
protocol -- this traffic is what Agent Gateway (egress mode) inspects to
extract tool names and read-only hints for its authorization policies (see
docs/gcp-mapping.md). In production this call would route through the
egress Agent Gateway rather than hitting mcp-server's URL directly; see
AGENT_GATEWAY_EGRESS_URL below.
"""

import itertools
import os
from typing import Any

import httpx

MCP_SERVER_URL = os.environ.get("MCP_SERVER_URL", "http://localhost:8082")
MCP_ENDPOINT = f"{MCP_SERVER_URL.rstrip('/')}/mcp"

_id_counter = itertools.count(1)


async def call_tool(
    name: str,
    arguments: dict[str, Any],
    *,
    correlation_id: str | None = None,
    obo_token: str | None = None,
) -> dict[str, Any]:
    """Calls one MCP tool via a real JSON-RPC 2.0 tools/call request."""
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
    }
    if correlation_id:
        headers["X-Correlation-Id"] = correlation_id
    if obo_token:
        headers["X-Obo-Token"] = obo_token

    payload = {
        "jsonrpc": "2.0",
        "id": next(_id_counter),
        "method": "tools/call",
        "params": {"name": name, "arguments": arguments},
    }

    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(MCP_ENDPOINT, headers=headers, json=payload)
        resp.raise_for_status()
        body = _parse_jsonrpc_response(resp)

    if "error" in body:
        raise RuntimeError(f"MCP error calling {name}: {body['error']}")

    result = body.get("result", {})
    if result.get("isError"):
        text = _first_text(result)
        raise RuntimeError(f"MCP tool {name} returned an error: {text}")

    return {"text": _first_text(result)}


def _first_text(result: dict[str, Any]) -> str:
    for block in result.get("content", []):
        if block.get("type") == "text":
            return block["text"]
    return ""


def _parse_jsonrpc_response(resp: httpx.Response) -> dict[str, Any]:
    content_type = resp.headers.get("content-type", "")
    if "text/event-stream" in content_type:
        # StreamableHTTPServerTransport in stateless mode replies with a
        # single `event: message` / `data: {...}` frame for a single request.
        for line in resp.text.splitlines():
            if line.startswith("data:"):
                import json

                return json.loads(line[len("data:") :].strip())
        raise RuntimeError("empty SSE response from MCP server")
    return resp.json()
