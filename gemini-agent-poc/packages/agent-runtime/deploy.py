"""Deploys real_estate_agent to real Vertex AI Agent Runtime.

Provisions a real Agent Identity (SPIFFE-based, mTLS, no shared secrets) and
routes the agent's traffic through the two real Agent Gateways created
earlier: ingress (client-to-agent, fronting calls from frontdoor) and egress
(agent-to-anywhere, fronting calls the agent makes to the MCP server).

Usage:
    source .venv/bin/activate
    python deploy.py
"""

import os

import vertexai
from vertexai import types
from vertexai.agent_engines import AdkApp

from real_estate_agent.agent import root_agent

PROJECT_ID = os.environ.get("GCP_PROJECT_ID", "fresh-eyes-501103")
LOCATION = os.environ.get("GCP_LOCATION", "us-central1")
STAGING_BUCKET = os.environ.get(
    "AGENT_ENGINE_STAGING_BUCKET", f"gs://{PROJECT_ID}-agent-engine-staging"
)
MCP_SERVER_URL = os.environ.get(
    "MCP_SERVER_URL", "https://gemini-poc-mcp-server-67873858780.us-central1.run.app"
)
GATEWAY_INGRESS = (
    f"projects/{PROJECT_ID}/locations/{LOCATION}/agentGateways/real-estate-agent-gateway-ingress"
)
GATEWAY_EGRESS = (
    f"projects/{PROJECT_ID}/locations/{LOCATION}/agentGateways/real-estate-agent-gateway-egress"
)


WITH_EGRESS_GATEWAY = os.environ.get("WITH_EGRESS_GATEWAY", "false").lower() == "true"
WITH_INGRESS_GATEWAY = os.environ.get("WITH_INGRESS_GATEWAY", "false").lower() == "true"

GATEWAY_CA_BUNDLE = "/usr/local/share/gateway-ca-bundle.pem"


def main():
    client = vertexai.Client(
        project=PROJECT_ID, location=LOCATION, http_options=dict(api_version="v1beta1")
    )
    app = AdkApp(agent=root_agent)

    env_vars = {"MCP_SERVER_URL": MCP_SERVER_URL}
    extra_packages = ["./real_estate_agent"]

    if WITH_EGRESS_GATEWAY:
        # installation_scripts/install-gateway-ca.sh installs the egress
        # gateway's TLS inspection CA at build time (runs as root, before the
        # container drops to the unprivileged app user) -- an unverified
        # alternative to the documented BYOC cert-injection path.
        extra_packages.append("./installation_scripts")
        env_vars.update(
            {
                "REQUESTS_CA_BUNDLE": GATEWAY_CA_BUNDLE,
                "SSL_CERT_FILE": GATEWAY_CA_BUNDLE,
                "GRPC_DEFAULT_SSL_ROOTS_FILE_PATH": GATEWAY_CA_BUNDLE,
            }
        )

    config = {
        "display_name": "real-estate-agent",
        "description": root_agent.description,
        "identity_type": types.IdentityType.AGENT_IDENTITY,
        "requirements": [
            "google-cloud-aiplatform[adk,agent_engines]",
            "httpx",
            "cloudpickle",
            "pydantic",
        ],
        "extra_packages": extra_packages,
        "staging_bucket": STAGING_BUCKET,
        "env_vars": env_vars,
    }

    agent_gateway_config = {}
    if WITH_EGRESS_GATEWAY:
        agent_gateway_config["agent_to_anywhere_config"] = {"agent_gateway": GATEWAY_EGRESS}
    if WITH_INGRESS_GATEWAY:
        agent_gateway_config["client_to_agent_config"] = {"agent_gateway": GATEWAY_INGRESS}
    if agent_gateway_config:
        config["agent_gateway_config"] = agent_gateway_config

    remote_app = client.agent_engines.create(agent=app, config=config)

    print("Deployed. Resource name:", remote_app.api_resource.name)
    print("Reasoning engine ID:", remote_app.api_resource.name.rsplit("/", 1)[-1])


if __name__ == "__main__":
    main()
