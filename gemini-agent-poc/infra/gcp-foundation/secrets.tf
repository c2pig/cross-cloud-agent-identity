# Signing material is generated once and stored only in Secret Manager and
# this stack's local state. Do not copy the values into Git.

resource "random_password" "obo_signing_secret" {
  length  = 48
  special = false
}

resource "random_password" "agent_identity_signing_secret" {
  length  = 48
  special = false
}

resource "random_password" "frontdoor_to_agent_key" {
  length  = 32
  special = false
}

resource "google_secret_manager_secret" "obo_signing_secret" {
  secret_id = "gemini-poc-obo-signing-secret"
  replication {
    auto {}
  }
  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "obo_signing_secret" {
  secret      = google_secret_manager_secret.obo_signing_secret.id
  secret_data = random_password.obo_signing_secret.result
}

resource "google_secret_manager_secret" "agent_identity_signing_secret" {
  secret_id = "gemini-poc-agent-identity-signing-secret"
  replication {
    auto {}
  }
  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "agent_identity_signing_secret" {
  secret      = google_secret_manager_secret.agent_identity_signing_secret.id
  secret_data = random_password.agent_identity_signing_secret.result
}

resource "google_secret_manager_secret" "frontdoor_to_agent_key" {
  secret_id = "gemini-poc-frontdoor-to-agent-key"
  replication {
    auto {}
  }
  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "frontdoor_to_agent_key" {
  secret      = google_secret_manager_secret.frontdoor_to_agent_key.id
  secret_data = random_password.frontdoor_to_agent_key.result
}

# Kept for the retired Node agent-service signing path. The live MCP server
# does not read this secret; the binding remains so an import does not drop it.
resource "google_secret_manager_secret_iam_member" "agent_identity_agent" {
  secret_id = google_secret_manager_secret.agent_identity_signing_secret.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.agent.email}"
}

resource "google_secret_manager_secret_iam_member" "agent_identity_mcp_server" {
  secret_id = google_secret_manager_secret.agent_identity_signing_secret.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.mcp_server.email}"
}

resource "google_secret_manager_secret_iam_member" "obo_frontdoor" {
  secret_id = google_secret_manager_secret.obo_signing_secret.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.frontdoor.email}"
}

resource "google_secret_manager_secret_iam_member" "obo_mcp_server" {
  secret_id = google_secret_manager_secret.obo_signing_secret.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.mcp_server.email}"
}

resource "google_secret_manager_secret_iam_member" "frontdoor_key_frontdoor" {
  secret_id = google_secret_manager_secret.frontdoor_to_agent_key.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.frontdoor.email}"
}

resource "google_secret_manager_secret_iam_member" "frontdoor_key_agent" {
  secret_id = google_secret_manager_secret.frontdoor_to_agent_key.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.agent.email}"
}
