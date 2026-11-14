output "mcp_server_url" {
  description = "Passed to the agent process as MCP_SERVER_URL. deploy.py still creates the engine."
  value       = google_cloud_run_v2_service.mcp_server.uri
}

output "bridge_url" {
  value = google_cloud_run_v2_service.bridge.uri
}

output "frontdoor_url" {
  value = google_cloud_run_v2_service.frontdoor.uri
}

output "frontend_url" {
  value = google_cloud_run_v2_service.frontend.uri
}

output "artifact_registry_repo" {
  value = local.repo_prefix
}
