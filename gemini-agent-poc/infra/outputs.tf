output "mcp_server_url" {
  value = google_cloud_run_v2_service.mcp_server.uri
}

output "agent_service_url" {
  value = google_cloud_run_v2_service.agent_service.uri
}

output "frontdoor_url" {
  value = google_cloud_run_v2_service.frontdoor.uri
}

output "frontend_url" {
  value = google_cloud_run_v2_service.frontend.uri
}

output "artifact_registry_repo" {
  value = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.images.repository_id}"
}
