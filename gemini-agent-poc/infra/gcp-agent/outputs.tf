output "staging_bucket" {
  value = google_storage_bucket.agent_engine_staging.url
}

output "mcp_server_url" {
  description = "Echo of the URL deploy.py should use. Empty until gcp-runtime has been applied and the variable is set."
  value       = var.mcp_server_url
}

output "reasoning_engine_deploy" {
  description = "Command that still creates the engine. Do not expect Terraform to replace it."
  value       = "MCP_SERVER_URL=${var.mcp_server_url} python packages/agent-runtime/deploy.py"
}
