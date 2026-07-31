locals {
  repo_prefix = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.images.repository_id}"
}

resource "google_cloud_run_v2_service" "mcp_server" {
  name     = "gemini-poc-mcp-server"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.mcp_server.email
    containers {
      image = "${local.repo_prefix}/mcp-server:${var.image_tag}"
      env {
        name  = "AGENT_REGISTRY_PATH"
        value = "/app/registry/agents.json"
      }
      env {
        name = "AGENT_IDENTITY_SIGNING_SECRET"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.agent_identity_signing_secret.secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "OBO_SIGNING_SECRET"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.obo_signing_secret.secret_id
            version = "latest"
          }
        }
      }
    }
  }
  depends_on = [google_project_service.apis]
}

resource "google_cloud_run_v2_service_iam_member" "mcp_server_invoker" {
  count    = var.enforce_cloud_run_iam_invoker ? 1 : 0
  name     = google_cloud_run_v2_service.mcp_server.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.agent_service.email}"
}

resource "google_cloud_run_v2_service_iam_member" "mcp_server_public" {
  count    = var.enforce_cloud_run_iam_invoker ? 0 : 1
  name     = google_cloud_run_v2_service.mcp_server.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_v2_service" "agent_service" {
  name     = "gemini-poc-agent-service"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.agent_service.email
    containers {
      image = "${local.repo_prefix}/agent-service:${var.image_tag}"
      env {
        name  = "MCP_SERVER_URL"
        value = google_cloud_run_v2_service.mcp_server.uri
      }
      env {
        name  = "AGENT_IDENTITY_ID"
        value = "agents/real-estate-agent-v1"
      }
      env {
        name  = "GEMINI_MODEL"
        value = "gemini-2.0-flash"
      }
      dynamic "env" {
        for_each = var.gemini_api_key != "" ? [1] : []
        content {
          name = "GEMINI_API_KEY"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.gemini_api_key[0].secret_id
              version = "latest"
            }
          }
        }
      }
      env {
        name = "AGENT_IDENTITY_SIGNING_SECRET"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.agent_identity_signing_secret.secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "FRONTDOOR_TO_AGENT_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.frontdoor_to_agent_key.secret_id
            version = "latest"
          }
        }
      }
    }
  }
  depends_on = [google_project_service.apis]
}

resource "google_cloud_run_v2_service_iam_member" "agent_service_invoker" {
  count    = var.enforce_cloud_run_iam_invoker ? 1 : 0
  name     = google_cloud_run_v2_service.agent_service.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.frontdoor.email}"
}

resource "google_cloud_run_v2_service_iam_member" "agent_service_public" {
  count    = var.enforce_cloud_run_iam_invoker ? 0 : 1
  name     = google_cloud_run_v2_service.agent_service.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_v2_service" "frontdoor" {
  name     = "gemini-poc-frontdoor"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.frontdoor.email
    containers {
      image = "${local.repo_prefix}/frontdoor:${var.image_tag}"
      env {
        name  = "AUTH0_DOMAIN"
        value = var.auth0_domain
      }
      env {
        name  = "AUTH0_AUDIENCE"
        value = var.auth0_audience
      }
      env {
        name  = "AGENT_SERVICE_URL"
        value = google_cloud_run_v2_service.agent_service.uri
      }
      env {
        name  = "AGENT_IDENTITY_ID"
        value = "agents/real-estate-agent-v1"
      }
      env {
        name = "OBO_SIGNING_SECRET"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.obo_signing_secret.secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "FRONTDOOR_TO_AGENT_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.frontdoor_to_agent_key.secret_id
            version = "latest"
          }
        }
      }
    }
  }
  depends_on = [google_project_service.apis]
}

resource "google_cloud_run_v2_service_iam_member" "frontdoor_public" {
  count    = var.allow_unauthenticated_frontdoor ? 1 : 0
  name     = google_cloud_run_v2_service.frontdoor.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# The frontend image must be built *after* frontdoor exists (its URL is
# baked in at build time via VITE_FRONTDOOR_URL -- see infra/README.md for
# the two-phase apply this implies). image_tag for this service is expected
# to be supplied on the second apply once that build has happened.
resource "google_cloud_run_v2_service" "frontend" {
  name     = "gemini-poc-frontend"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    containers {
      image = "${local.repo_prefix}/frontend:${var.image_tag}"
    }
  }
  depends_on = [google_project_service.apis, google_cloud_run_v2_service.frontdoor]
}

resource "google_cloud_run_v2_service_iam_member" "frontend_public" {
  name     = google_cloud_run_v2_service.frontend.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}
