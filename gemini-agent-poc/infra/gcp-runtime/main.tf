resource "google_cloud_run_v2_service" "mcp_server" {
  name     = "gemini-poc-mcp-server"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = local.mcp_sa
    containers {
      image = "${local.repo_prefix}/mcp-server:${var.image_tag}"
      env {
        name = "OBO_SIGNING_SECRET"
        value_source {
          secret_key_ref {
            secret  = local.obo_secret_id
            version = "latest"
          }
        }
      }
    }
  }
}

resource "google_cloud_run_v2_service_iam_member" "mcp_server_invoker" {
  count    = var.enforce_cloud_run_iam_invoker ? 1 : 0
  name     = google_cloud_run_v2_service.mcp_server.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "serviceAccount:${local.agent_sa}"
}

resource "google_cloud_run_v2_service_iam_member" "mcp_server_public" {
  count    = var.enforce_cloud_run_iam_invoker ? 0 : 1
  name     = google_cloud_run_v2_service.mcp_server.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_v2_service" "bridge" {
  name     = "gemini-poc-agent-bridge"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = local.agent_sa
    containers {
      image = "${local.repo_prefix}/agent-bridge:${var.image_tag}"
      env {
        name  = "GCP_PROJECT_ID"
        value = var.project_id
      }
      env {
        name  = "GCP_LOCATION"
        value = var.region
      }
      env {
        name  = "REASONING_ENGINE_ID"
        value = var.reasoning_engine_id
      }
      env {
        name = "FRONTDOOR_TO_AGENT_KEY"
        value_source {
          secret_key_ref {
            secret  = local.frontdoor_key_secret
            version = "latest"
          }
        }
      }
    }
  }
}

resource "google_cloud_run_v2_service_iam_member" "bridge_invoker" {
  count    = var.enforce_cloud_run_iam_invoker ? 1 : 0
  name     = google_cloud_run_v2_service.bridge.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "serviceAccount:${local.frontdoor_sa}"
}

resource "google_cloud_run_v2_service_iam_member" "bridge_public" {
  count    = var.enforce_cloud_run_iam_invoker ? 0 : 1
  name     = google_cloud_run_v2_service.bridge.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_v2_service" "frontdoor" {
  name     = "gemini-poc-frontdoor"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = local.frontdoor_sa
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
        name  = "ALLOW_MOCK_AUTH"
        value = "false"
      }
      env {
        name  = "AGENT_SERVICE_URL"
        value = google_cloud_run_v2_service.bridge.uri
      }
      env {
        name  = "AGENT_IDENTITY_ID"
        value = "agents/real-estate-agent-v1"
      }
      env {
        name = "OBO_SIGNING_SECRET"
        value_source {
          secret_key_ref {
            secret  = local.obo_secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "FRONTDOOR_TO_AGENT_KEY"
        value_source {
          secret_key_ref {
            secret  = local.frontdoor_key_secret
            version = "latest"
          }
        }
      }
    }
  }
}

resource "google_cloud_run_v2_service_iam_member" "frontdoor_public" {
  count    = var.allow_unauthenticated_frontdoor ? 1 : 0
  name     = google_cloud_run_v2_service.frontdoor.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# The frontend image must be built after frontdoor exists. VITE_FRONTDOOR_URL
# and VITE_AUTH0_CLIENT_ID are baked in at image build time (see scripts/deploy.sh).
resource "google_cloud_run_v2_service" "frontend" {
  name     = "gemini-poc-frontend"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    containers {
      image = "${local.repo_prefix}/frontend:${var.image_tag}"
    }
  }

  depends_on = [google_cloud_run_v2_service.frontdoor]
}

resource "google_cloud_run_v2_service_iam_member" "frontend_public" {
  name     = google_cloud_run_v2_service.frontend.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}
