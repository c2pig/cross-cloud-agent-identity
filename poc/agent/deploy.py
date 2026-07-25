"""
Packages and deploys agent.py to Vertex AI Agent Engine.

Prints the resulting `reasoningEngines/{ID}` resource path to stdout so it
can be copied into `.env` as REASONING_ENGINE_ID.

Usage:
    GCP_PROJECT_ID=... GCP_LOCATION=us-central1 \
    GATEWAY_MCP_URL=... GATEWAY_AUDIENCE=... \
    python deploy.py
"""
import os

import vertexai
from vertexai import agent_engines

from agent import root_agent

GCP_PROJECT_ID = os.environ["GCP_PROJECT_ID"]
GCP_LOCATION = os.environ.get("GCP_LOCATION", "us-central1")
STAGING_BUCKET = os.environ.get(
    "GCP_STAGING_BUCKET", f"gs://{GCP_PROJECT_ID}-agent-engine-staging"
)


def main():
    vertexai.init(
        project=GCP_PROJECT_ID,
        location=GCP_LOCATION,
        staging_bucket=STAGING_BUCKET,
    )

    remote_agent = agent_engines.create(
        root_agent,
        requirements="requirements.txt",
        display_name="poc-hello-agent",
        extra_packages=["agent.py"],
        env_vars={
            "GATEWAY_MCP_URL": os.environ["GATEWAY_MCP_URL"],
            "GATEWAY_AUDIENCE": os.environ["GATEWAY_AUDIENCE"],
        },
    )

    print(f"Deployed reasoning engine: {remote_agent.resource_name}")
    reasoning_engine_id = remote_agent.resource_name.split("/")[-1]
    print(f"REASONING_ENGINE_ID={reasoning_engine_id}")


if __name__ == "__main__":
    main()
