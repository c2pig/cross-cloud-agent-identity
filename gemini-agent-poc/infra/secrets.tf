# These three are POC stand-ins for real trust-broker signing keys (see
# docs/gcp-mapping.md) -- generated once here and shared, via Secret Manager,
# only with the specific services that need to mint or verify each token.
# Least-privilege access is enforced below: each accessor binding is scoped
# to exactly the service accounts that need that one secret.

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

resource "google_secret_manager_secret" "gemini_api_key" {
  count     = var.gemini_api_key != "" ? 1 : 0
  secret_id = "gemini-poc-gemini-api-key"
  replication {
    auto {}
  }
  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "gemini_api_key" {
  count       = var.gemini_api_key != "" ? 1 : 0
  secret      = google_secret_manager_secret.gemini_api_key[0].id
  secret_data = var.gemini_api_key
}

# -- Least-privilege accessor bindings --

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

resource "google_secret_manager_secret_iam_member" "agent_identity_agent_service" {
  secret_id = google_secret_manager_secret.agent_identity_signing_secret.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.agent_service.email}"
}

resource "google_secret_manager_secret_iam_member" "agent_identity_mcp_server" {
  secret_id = google_secret_manager_secret.agent_identity_signing_secret.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.mcp_server.email}"
}

resource "google_secret_manager_secret_iam_member" "frontdoor_key_frontdoor" {
  secret_id = google_secret_manager_secret.frontdoor_to_agent_key.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.frontdoor.email}"
}

resource "google_secret_manager_secret_iam_member" "frontdoor_key_agent_service" {
  secret_id = google_secret_manager_secret.frontdoor_to_agent_key.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.agent_service.email}"
}

resource "google_secret_manager_secret_iam_member" "gemini_key_agent_service" {
  count     = var.gemini_api_key != "" ? 1 : 0
  secret_id = google_secret_manager_secret.gemini_api_key[0].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.agent_service.email}"
}
