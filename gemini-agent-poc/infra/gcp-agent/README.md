# GCP agent

Supporting resources for the Vertex AI agent. The reasoning engine and the two Agent Gateways are not Terraform resources in `hashicorp/google` or `hashicorp/google-beta` 6.x, so this stack does not pretend to create them.

## Owns

- Staging bucket `${project_id}-agent-engine-staging`
- `roles/aiplatform.expressUser` on `gemini-poc-agent`, which the Cloud Run bridge uses to call the reasoning engine

## Does not own

- Reasoning engine `real-estate-agent` (`reasoningEngines/2124909025014317056`). Create and update it with [`packages/agent-runtime/deploy.py`](../../packages/agent-runtime/deploy.py). `WITH_EGRESS_GATEWAY` and `WITH_INGRESS_GATEWAY` stay unset.
- Ingress gateway `real-estate-agent-gateway-ingress` ([gateway-ingress.yaml](../../packages/agent-runtime/gateway-ingress.yaml))
- Egress gateway `real-estate-agent-gateway-egress` ([gateway-egress.yaml](../../packages/agent-runtime/gateway-egress.yaml))

Both gateways exist in the live project and stay unattached.

`mcp_server_url` is the `mcp_server_url` output of `infra/gcp-runtime`. Pass it through so operators have one place to copy into `deploy.py`. It does not create the engine.

```bash
terraform init
terraform plan \
  -var=project_id="$GCP_PROJECT_ID" \
  -var=mcp_server_url="$MCP_SERVER_URL"
```
