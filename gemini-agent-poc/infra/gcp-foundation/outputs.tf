output "artifact_registry_repo" {
  value = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.images.repository_id}"
}

output "frontdoor_service_account" {
  value = google_service_account.frontdoor.email
}

output "agent_service_account" {
  value = google_service_account.agent.email
}

output "mcp_server_service_account" {
  value = google_service_account.mcp_server.email
}

output "obo_signing_secret_id" {
  value = google_secret_manager_secret.obo_signing_secret.secret_id
}

output "frontdoor_to_agent_key_secret_id" {
  value = google_secret_manager_secret.frontdoor_to_agent_key.secret_id
}
