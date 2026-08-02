"""Deploys the BYOC (custom container) image to Vertex AI Agent Runtime.

Unlike deploy.py (managed path, pickled agent object), this points Agent
Runtime at a container image we built and own (packages/agent-runtime/byoc/),
which is what lets us install the Agent Gateway egress CA via a normal
Dockerfile RUN step instead of the unverified installation_scripts hook.
"""

import os

import vertexai
from vertexai import types

PROJECT_ID = os.environ.get("GCP_PROJECT_ID", "fresh-eyes-501103")
LOCATION = os.environ.get("GCP_LOCATION", "us-central1")
IMAGE_URI = os.environ.get(
    "IMAGE_URI", "us-central1-docker.pkg.dev/fresh-eyes-501103/gemini-agent-poc/agent-byoc:latest"
)
GATEWAY_INGRESS = (
    f"projects/{PROJECT_ID}/locations/{LOCATION}/agentGateways/real-estate-agent-gateway-ingress"
)
GATEWAY_EGRESS = (
    f"projects/{PROJECT_ID}/locations/{LOCATION}/agentGateways/real-estate-agent-gateway-egress"
)

WITH_EGRESS_GATEWAY = os.environ.get("WITH_EGRESS_GATEWAY", "true").lower() == "true"
WITH_INGRESS_GATEWAY = os.environ.get("WITH_INGRESS_GATEWAY", "false").lower() == "true"


def main():
    client = vertexai.Client(
        project=PROJECT_ID, location=LOCATION, http_options=dict(api_version="v1beta1")
    )

    config = {
        "display_name": "real-estate-agent-byoc",
        "description": "Real-estate concierge agent (BYOC container)",
        "identity_type": types.IdentityType.AGENT_IDENTITY,
        "container_spec": {"image_uri": IMAGE_URI},
        "agent_framework": "google-adk",
        "class_methods": [
            {
                "name": "stream_query",
                "api_mode": "stream",
                "description": "Streams responses from the ADK application in response to a message.",
                "parameters": {
                    "type": "object",
                    "required": ["message", "user_id"],
                    "properties": {
                        "message": {
                            "anyOf": [
                                {"type": "string"},
                                {"type": "object", "additionalProperties": True},
                            ]
                        },
                        "user_id": {"type": "string"},
                        "session_id": {"type": "string", "nullable": True},
                        "run_config": {"type": "object", "nullable": True},
                    },
                },
            }
        ],
        "env_vars": {
            "MCP_SERVER_URL": "https://gemini-poc-mcp-server-67873858780.us-central1.run.app",
            "GCP_PROJECT_ID": PROJECT_ID,
            "GCP_LOCATION": LOCATION,
            "GOOGLE_CLOUD_AGENT_ENGINE_ENABLE_TELEMETRY": "false",
        },
    }

    agent_gateway_config = {}
    if WITH_EGRESS_GATEWAY:
        agent_gateway_config["agent_to_anywhere_config"] = {"agent_gateway": GATEWAY_EGRESS}
    if WITH_INGRESS_GATEWAY:
        agent_gateway_config["client_to_agent_config"] = {"agent_gateway": GATEWAY_INGRESS}
    if agent_gateway_config:
        config["agent_gateway_config"] = agent_gateway_config

    remote_app = client.agent_engines.create(config=config)

    print("Deployed. Resource name:", remote_app.api_resource.name)
    print("Reasoning engine ID:", remote_app.api_resource.name.rsplit("/", 1)[-1])


if __name__ == "__main__":
    main()
