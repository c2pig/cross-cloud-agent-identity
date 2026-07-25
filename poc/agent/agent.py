"""
POC "hello world" agent, deployed to Vertex AI Agent Engine.

Its only job is to say "hello world," then call the AWS AgentCore Gateway
(via a Google-minted ID token) and relay its response too. An OpenTelemetry
span is opened per request, carrying `enduser.id` and `correlation_id` so
the call can be joined against Cloud Trace and, on the AWS side,
AgentCore Observability / CloudWatch for the same `correlation_id`.
"""
import os

import requests
from google.auth.transport.requests import Request as GoogleAuthRequest
from google.oauth2.id_token import fetch_id_token
from opentelemetry import trace
from opentelemetry.exporter.cloud_trace import CloudTraceSpanExporter
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

GATEWAY_MCP_URL = os.environ["GATEWAY_MCP_URL"]
GATEWAY_AUDIENCE = os.environ["GATEWAY_AUDIENCE"]

_provider = TracerProvider()
_provider.add_span_processor(BatchSpanProcessor(CloudTraceSpanExporter()))
trace.set_tracer_provider(_provider)
tracer = trace.get_tracer("poc-hello-agent")


def _traceparent_header(correlation_id: str) -> str:
    # traceparent trace-id is 32 hex chars; pad/truncate the correlation_id to fit.
    trace_id = correlation_id.replace("-", "").ljust(32, "0")[:32]
    return f"00-{trace_id}-0000000000000001-01"


def _call_aws_agentcore(enduser_id: str, correlation_id: str) -> dict:
    google_request = GoogleAuthRequest()
    id_token = fetch_id_token(google_request, GATEWAY_AUDIENCE)

    headers = {
        "Authorization": f"Bearer {id_token}",
        "traceparent": _traceparent_header(correlation_id),
        "X-Enduser-Id": enduser_id,
        "Content-Type": "application/json",
    }
    mcp_body = {
        "jsonrpc": "2.0",
        "id": correlation_id,
        "method": "tools/call",
        "params": {
            "name": "hello_world_lambda",
            "arguments": {},
        },
    }
    resp = requests.post(GATEWAY_MCP_URL, headers=headers, json=mcp_body, timeout=30)
    resp.raise_for_status()
    return resp.json()


class HelloWorldAgent:
    """Entry point invoked by the Agent Engine runtime via `query`."""

    def query(self, input: dict, config: dict | None = None) -> dict:
        configurable = (config or {}).get("configurable", {})
        enduser_id = configurable.get("enduser_id", "unknown")
        correlation_id = configurable.get("correlation_id", "unknown")

        with tracer.start_as_current_span("poc-hello-agent.query") as span:
            span.set_attribute("enduser.id", enduser_id)
            span.set_attribute("correlation_id", correlation_id)

            gcp_response = "hello world"

            try:
                aws_result = _call_aws_agentcore(enduser_id, correlation_id)
                aws_response = aws_result.get("result", aws_result)
                span.set_attribute("aws.call.status", "success")
            except Exception as exc:
                aws_response = f"error calling AWS AgentCore: {exc}"
                span.set_attribute("aws.call.status", "failure")
                span.record_exception(exc)

            return {
                "gcp_response": gcp_response,
                "aws_response": aws_response,
                "correlation_id": correlation_id,
            }


root_agent = HelloWorldAgent()
